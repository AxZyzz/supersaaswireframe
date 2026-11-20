import { createHash } from 'crypto';
import { Inject, Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import {
  buildInsights,
  evaluateFactor,
  type FactorEval,
  headlineMetric,
  type Insight,
  sendTimeStatus,
  type SendTimeStatus,
  starsCheck,
  type StarsCheck,
} from './insight-rules';
import {
  FACTORS,
  type FactorDef,
  type FactorId,
  type GridRow,
  type BucketRow,
  type InsightsData,
  type InsightsSource,
  METRICS,
  type Metric,
} from './types';

export const INSIGHTS_SOURCE = 'INSIGHTS_SOURCE';

export interface InsightsFilters {
  offerId?: string;
  campaignIds?: string[];
  from?: Date;
  to?: Date;
}

export interface FactorView {
  def: FactorDef;
  /** Rate factors: one evaluation per metric, so the page can switch instantly. */
  evals: Partial<Record<Metric, FactorEval>>;
  /** Distribution factors (sequence step): plain counts. */
  rows: BucketRow[];
  /** false when we never varied the thing (send times): shown, never ranked. */
  comparable: boolean;
}

export interface InsightsResponse {
  source: string;
  generatedAt: string;
  cached: boolean;
  filters: {
    offerId: string | null;
    campaignIds: string[];
    from: string | null;
    to: string | null;
  };
  totals: InsightsData['totals'];
  /** The metric the headlines use: confirmed qualified once half the interested replies are settled. */
  headlineMetric: Metric;
  headlines: Insight[];
  /** "Most opens from Mumbai": diagnostics, kept apart from the headlines. */
  diagnostics: Insight[];
  factors: FactorView[];
  stars: StarsCheck;
  sendTime: {
    status: SendTimeStatus;
    grid: GridRow[];
    /** Overall reply rate, to colour cells against. */
    overallReplyRate: number | null;
  };
  timezone: InsightsData['timezone'];
  /** Interested replies a person has settled: why qualified leads (or not). */
  coverage: { positive: number; qualified: number; ratio: number | null };
  note: string;
}

const CACHE_TTL_SECONDS = 600;

/**
 * Insights (Learning Loop T06): turns a source's bucket rows into plain
 * sentences with the pure rules in insight-rules.ts. Everything is exploratory.
 * Results are cached 10 minutes per workspace + filters (Redis; if Redis is
 * down it simply recomputes).
 */
@Injectable()
export class InsightsService implements OnModuleDestroy {
  private readonly logger = new Logger(InsightsService.name);
  private redis: Redis | null = null;
  /** Tests turn this off to see fresh numbers. */
  cacheEnabled = true;
  cacheTtlSeconds = CACHE_TTL_SECONDS;

  constructor(
    @Inject(INSIGHTS_SOURCE) private readonly source: InsightsSource,
    private readonly config: ConfigService,
  ) {}

  async onModuleDestroy() {
    await this.redis?.quit().catch(() => undefined);
  }

  private client(): Redis {
    if (!this.redis) {
      this.redis = new Redis(
        this.config.get<string>('REDIS_URL', 'redis://localhost:6379'),
        // short timeouts: a slow Redis means "no cache", never a slow page
        { maxRetriesPerRequest: 1, commandTimeout: 500, lazyConnect: true },
      );
      this.redis.on('error', (e: Error) =>
        this.logger.warn(`insights cache redis: ${e.message}`),
      );
    }
    return this.redis;
  }

  private key(orgId: string, f: InsightsFilters): string {
    const norm = {
      o: f.offerId ?? null,
      c: [...(f.campaignIds ?? [])].sort(),
      f: f.from?.toISOString() ?? null,
      t: f.to?.toISOString() ?? null,
    };
    const h = createHash('sha1')
      .update(JSON.stringify(norm))
      .digest('hex')
      .slice(0, 20);
    return `${process.env.QUEUE_PREFIX || 'bull'}:insights:v1:${orgId}:${h}`;
  }

  async get(
    orgId: string,
    filters: InsightsFilters,
  ): Promise<InsightsResponse> {
    const key = this.key(orgId, filters);
    if (this.cacheEnabled) {
      try {
        const hit = await this.client().get(key);
        if (hit)
          return { ...(JSON.parse(hit) as InsightsResponse), cached: true };
      } catch {
        /* cache down: compute */
      }
    }
    const fresh = await this.compute(orgId, filters);
    if (this.cacheEnabled) {
      try {
        await this.client().set(
          key,
          JSON.stringify(fresh),
          'EX',
          this.cacheTtlSeconds,
        );
      } catch {
        /* best effort */
      }
    }
    return fresh;
  }

  async compute(
    orgId: string,
    filters: InsightsFilters,
  ): Promise<InsightsResponse> {
    const data = await this.source.all({ orgId, ...filters });
    const status = sendTimeStatus(data.sendBlocksUsed);

    const factors: FactorView[] = FACTORS.map((def) => {
      const rows = data.buckets[def.id];
      if (def.kind === 'distribution') {
        return { def, evals: {}, rows, comparable: true };
      }
      const evals: Partial<Record<Metric, FactorEval>> = {};
      for (const m of METRICS) evals[m] = evaluateFactor(def.id, rows, m);
      const isTime = def.id === 'send_day' || def.id === 'send_hour';
      return { def, evals, rows, comparable: !isTime || status.comparable };
    });

    const lead = headlineMetric(data.totals);
    // headlines only come from things we actually varied (never an invented "best time")
    const ranked = (m: Metric): FactorEval[] =>
      factors
        .filter((f) => f.def.kind === 'rate' && f.comparable)
        .map((f) => f.evals[m] as FactorEval);
    const headlines = buildInsights(
      ranked(lead === 'qualified' ? 'qualified' : 'reply'),
    );
    const diagnostics = buildInsights(ranked('open'), 2);

    const stars = starsCheck(data.buckets.stars);
    const overallReplyRate =
      data.totals.reached > 0
        ? data.totals.replied / data.totals.reached
        : null;

    return {
      source: this.source.name,
      generatedAt: new Date().toISOString(),
      cached: false,
      filters: {
        offerId: filters.offerId ?? null,
        campaignIds: filters.campaignIds ?? [],
        from: filters.from?.toISOString() ?? null,
        to: filters.to?.toISOString() ?? null,
      },
      totals: data.totals,
      headlineMetric: lead === 'qualified' ? 'qualified' : 'reply',
      headlines,
      diagnostics,
      factors,
      stars,
      sendTime: { status, grid: data.grid, overallReplyRate },
      timezone: data.timezone,
      coverage: {
        positive: data.totals.positive,
        qualified: data.totals.qualified,
        ratio:
          data.totals.positive > 0
            ? data.totals.qualified / data.totals.positive
            : null,
      },
      note: 'Exploratory: scanning many factors always finds some that look good by chance. Use these as ideas to test, never as a verdict.',
    };
  }
}

export type { FactorId };
