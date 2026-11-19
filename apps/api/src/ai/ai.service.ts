import {
  Inject,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Pool } from 'pg';
import { PG_POOL } from '../db/db.module';
import { withOrgContext } from '../db/tenant-context';
import { AIGenerateOptions, AIResult } from './providers/ai-provider';
import { AIProviderResolver } from './providers/provider.resolver';

const RETRYABLE =
  /429|throttl|timeout|ETIMEDOUT|ECONNRESET|503|504|500|overloaded|RESOURCE_EXHAUSTED|UNAVAILABLE|DEADLINE_EXCEEDED/i;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Central entry point for all AI calls. Resolves the active provider, retries
// transient failures with backoff, and records per-org token usage. Usage
// logging is best-effort: a logging failure (e.g. table not yet migrated) never
// fails the generate call.
@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);

  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    private readonly resolver: AIProviderResolver,
  ) {}

  /** Active provider ("mock", "bedrock", "gemini"). */
  providerName(): string {
    return this.resolver.resolve().name;
  }

  async generate(
    orgId: string,
    feature: string,
    opts: AIGenerateOptions,
  ): Promise<AIResult> {
    const provider = this.resolver.resolve();
    const result = await this.withRetry(() => provider.generate(opts));
    void this.logUsage(
      orgId,
      feature,
      provider.name,
      result,
      opts.promptVersion,
    );
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
