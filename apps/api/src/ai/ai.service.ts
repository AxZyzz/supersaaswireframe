import {
  Inject,
  Injectable,
  Logger,
  Optional,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Pool } from 'pg';
import { PG_POOL } from '../db/db.module';
import { withOrgContext } from '../db/tenant-context';
import { AIGenerateOptions, AIResult } from './providers/ai-provider';
import { AIProviderResolver } from './providers/provider.resolver';
import { ModelRouter, RETRYABLE } from './router/model-router';
import { TASK_CATALOGUE, type AiTask } from './router/tasks';
import {
  SAFETY_SCREEN,
  safetyLog,
  type SafetyScreen,
} from './safety/safety-screen';

/** Every AI call states what it is for (see router/tasks.ts). */
export type AiCallOptions = AIGenerateOptions & { task?: AiTask };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Central entry point for all AI calls. Resolves the active provider, lets the
// ModelRouter pick the model per task (budget, circuit breaker, fallback),
// screens AI output with Model Armor, and records per-org token usage. Usage
// logging is best-effort: a logging failure (e.g. table not yet migrated) never
// fails the generate call.
@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);

  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    private readonly resolver: AIProviderResolver,
    // Optional so plain `new AiService(pool, resolver)` (unit tests) still
    // gets the original retry-only behaviour.
    @Optional() private readonly router?: ModelRouter,
    @Optional()
    @Inject(SAFETY_SCREEN)
    private readonly safety?: SafetyScreen,
  ) {}

  /** Active provider ("mock", "bedrock", "gemini"). */
  providerName(): string {
    return this.resolver.resolve().name;
  }

  async generate(
    orgId: string,
    feature: string,
    opts: AiCallOptions,
  ): Promise<AIResult> {
    const provider = this.resolver.resolve();
    const { task, ...providerOpts } = opts;
    let result: AIResult;
    if (this.router && task) {
      result = await this.router.execute(orgId, task, providerOpts, provider);
    } else {
      if (!task) {
        this.logger.warn(`AI call "${feature}" has no task: router skipped`);
      }
      result = await this.withRetry(() => provider.generate(providerOpts));
    }
    void this.logUsage(
      orgId,
      feature,
      provider.name,
      result,
      opts.promptVersion,
    );
    // Text a person will read or send is screened before it leaves.
    if (task && this.safety && TASK_CATALOGUE[task].screenOutput) {
      const screened = await this.safety.screenOutput(result.text, task);
      if (screened.verdict === 'blocked') {
        safetyLog('WARNING', {
          event: 'ai_output_withheld',
          task,
          findings: screened.findings.map((f) => f.filter),
        });
        throw new UnprocessableEntityException(
          'AI output withheld by safety check',
        );
      }
    }
    return result;
  }

  private async withRetry<T>(fn: () => Promise<T>, attempts = 3): Promise<T> {
    let lastErr: unknown;
    for (let i = 0; i < attempts; i++) {
      try {
        return await fn();
      } catch (err) {
        lastErr = err;
        const msg = err instanceof Error ? err.message : String(err);
        if (!RETRYABLE.test(msg)) throw err;
        if (i === attempts - 1) {
          // Still overloaded/rate-limited after retries: tell the user it's
          // temporary (503) instead of a generic 500.
          this.logger.warn(
            `AI provider busy after ${attempts} attempts: ${msg}`,
          );
          throw new ServiceUnavailableException(
            'The AI service is busy right now. Please try again in a minute.',
          );
        }
        const delay = 2 ** i * 500 + Math.floor(Math.random() * 250);
        this.logger.warn(
          `AI call failed (attempt ${i + 1}), retrying in ${delay}ms: ${msg}`,
        );
        await sleep(delay);
      }
    }
    throw lastErr;
  }

  private async logUsage(
    orgId: string,
    feature: string,
    provider: string,
    result: AIResult,
    promptVersion?: string,
  ): Promise<void> {
    try {
      await withOrgContext(this.pool, orgId, async (c) => {
        await c.query(
          `INSERT INTO ai_usage
             (org_id, feature, provider, model, input_tokens, output_tokens, prompt_version)
           VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [
            orgId,
            feature,
            provider,
            result.model,
            result.usage.inputTokens,
            result.usage.outputTokens,
            promptVersion ?? null,
          ],
        );
      });
    } catch (err) {
      this.logger.warn(
        `ai_usage logging failed for org ${orgId}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }
}
