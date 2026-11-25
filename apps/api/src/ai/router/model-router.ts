import {
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  OnModuleDestroy,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Pool } from 'pg';
import { PG_POOL } from '../../db/db.module';
import { withOrgContext } from '../../db/tenant-context';
import type {
  AIGenerateOptions,
  AIProvider,
  AIResult,
} from '../providers/ai-provider';
import { AiBudget, DEFAULT_DAILY_TOKEN_CAP, type BudgetLevel } from './budget';
import {
  CircuitBreaker,
  RedisCircuitStore,
  type CircuitStore,
} from './circuit-breaker';
import { downgradeTier, modelsForTier } from './policy';
import { RouteLog, type RouteReason } from './route-log';
import { TASK_CATALOGUE, type AiTask } from './tasks';

export const RETRYABLE =
  /429|throttl|timeout|timed out|ETIMEDOUT|ECONNRESET|503|504|500|overloaded|RESOURCE_EXHAUSTED|UNAVAILABLE|DEADLINE_EXCEEDED|high demand/i;
const MAX_ATTEMPTS = 3;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * The model arbiter. Every AI call states a task; the router picks the tier
 * (budget may lower it), the model list for that tier, skips models whose
 * circuit is open, falls back on failures, and logs why (`ai_route`).
 */
@Injectable()
export class ModelRouter implements OnModuleDestroy {
  private readonly logger = new Logger(ModelRouter.name);
  readonly log = new RouteLog();
  private breaker: CircuitBreaker | null = null;
  private redisStore: RedisCircuitStore | null = null;
  private budget: AiBudget;
  /** Tests set this to 0 so backoff does not slow them down. */
  backoffBaseMs = 500;

  constructor(
    private readonly config: ConfigService,
    @Inject(PG_POOL) private readonly pool: Pool,
  ) {
    this.budget = new AiBudget(
      (orgId) => this.loadTokensToday(orgId),
      () => this.dailyCap(),
    );
  }

  async onModuleDestroy() {
    await this.redisStore?.close();
  }

  // ── test seams ──────────────────────────────────────────────────────
  useCircuitStore(store: CircuitStore, now?: () => number) {
    this.breaker = new CircuitBreaker(store, now);
  }
  useBudget(budget: AiBudget) {
    this.budget = budget;
  }

  private dailyCap(): number {
    const raw = this.config.get<string>('AI_DAILY_TOKEN_CAP_PER_ORG')?.trim();
    if (!raw) return DEFAULT_DAILY_TOKEN_CAP; // blank = default
    const v = Number(raw);
    return Number.isFinite(v) && v >= 0 ? v : DEFAULT_DAILY_TOKEN_CAP;
  }

  private async loadTokensToday(orgId: string): Promise<number> {
    return withOrgContext(this.pool, orgId, async (c) => {
      const r = await c.query<{ n: string }>(
        `SELECT COALESCE(sum(input_tokens + output_tokens), 0)::text AS n
         FROM ai_usage WHERE created_at >= date_trunc('day', now())`,
      );
      return Number(r.rows[0]?.n ?? 0);
    });
  }

  private circuit(): CircuitBreaker {
    if (!this.breaker) {
      this.redisStore = new RedisCircuitStore(this.config);
      this.breaker = new CircuitBreaker(this.redisStore);
    }
    return this.breaker;
  }

  async execute(
    orgId: string,
    task: AiTask,
    opts: AIGenerateOptions,
    provider: AIProvider,
  ): Promise<AIResult> {
    const spec = TASK_CATALOGUE[task];

    // Budget: over the cap → one tier cheaper; over 2× → refuse non-essential.
    const level: BudgetLevel = await this.budget.level(orgId);
    if (level === 'hard' && !spec.essential) {
      throw new HttpException(
        'AI daily limit reached. It resets tomorrow; ask an admin if you need more.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    const wanted = opts.tier ?? spec.tier;
    const tier = level === 'ok' ? wanted : downgradeTier(wanted);
    let baseReason: RouteReason =
      tier !== wanted ? 'budget_downgrade' : 'policy';

    // Models for this tier, minus any whose circuit is open.
    let models: (string | null)[] = modelsForTier(
      provider.name,
      tier,
      this.config,
    );
    if (models.length === 0) models = [null]; // provider picks (Bedrock, mock)
    if (!spec.allowFallback) models = [models[0]];

    if (provider.name === 'gemini') {
      const open: string[] = [];
      for (const m of models) {
        if (m && (await this.circuit().isOpen(m))) open.push(m);
      }
      if (open.length > 0 && open.length < models.length) {
        if (open.includes(models[0] as string)) baseReason = 'circuit_open';
        models = models.filter((m) => !open.includes(m as string));
      }
    }

    const timeoutMs = this.config.get<string>('GEMINI_TIMEOUT_MS')
      ? undefined
      : spec.timeoutMs;

    let lastErr: unknown;
    let failedBefore = false;
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      const idx = Math.min(attempt, models.length - 1);
      const model = models[idx];
      const started = Date.now();
      try {
        const result = await provider.generate({
          ...opts,
          tier,
          maxTokens: opts.maxTokens ?? spec.maxOutputTokens,
          jsonSchema: opts.jsonSchema ?? spec.jsonSchema,
          ...(model ? { model } : {}),
          ...(timeoutMs ? { timeoutMs } : {}),
        });
        this.record(
          task,
          result.model,
          failedBefore ? 'fallback_timeout' : baseReason,
          attempt,
          started,
          true,
          result,
        );
        return result;
      } catch (err) {
        lastErr = err;
        failedBefore = true;
        const msg = err instanceof Error ? err.message : String(err);
        this.record(task, model, baseReason, attempt, started, false);
        if (!RETRYABLE.test(msg)) throw err;
        if (model && provider.name === 'gemini') {
          if (await this.circuit().recordFailure(model)) {
            this.log.record({
              at: new Date().toISOString(),
              kind: 'circuit_open',
              task,
              model,
              reason: null,
              attempt,
              latencyMs: 0,
              tokens: 0,
              ok: false,
            });
          }
        }
        if (attempt === MAX_ATTEMPTS - 1) break;
        const nextIdx = Math.min(attempt + 1, models.length - 1);
        this.logger.warn(
          `AI call failed (${task}, attempt ${attempt + 1}): ${msg}`,
        );
        if (nextIdx === idx) {
          await sleep(
            2 ** attempt * this.backoffBaseMs +
              Math.floor(Math.random() * Math.min(250, this.backoffBaseMs)),
          );
        }
      }
    }
    this.logger.warn(
      `AI provider busy after ${MAX_ATTEMPTS} attempts (${task}): ${
        lastErr instanceof Error ? lastErr.message : String(lastErr)
      }`,
    );
    throw new ServiceUnavailableException(
      'The AI service is busy right now. Please try again in a minute.',
    );
  }

  private record(
    task: AiTask,
    model: string | null,
    reason: RouteReason,
    attempt: number,
    started: number,
    ok: boolean,
    result?: AIResult,
  ) {
    this.log.record({
      at: new Date().toISOString(),
      kind: 'route',
      task,
      model,
      reason,
      attempt: attempt + 1,
      latencyMs: Date.now() - started,
      tokens: result ? result.usage.inputTokens + result.usage.outputTokens : 0,
      ok,
    });
  }
}
