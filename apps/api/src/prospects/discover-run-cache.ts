import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import type { DiscoverCandidate } from '../agents/contracts';

/** What gather found for one company, in a form that can sit in Redis. */
export interface CachedPages {
  homeUrl: string;
  fetchedUrls: string[];
  pages: { url: string; text: string }[];
  emails: {
    email: string;
    url: string;
    onCompanyDomain: boolean;
    mx: boolean;
  }[];
  skippedNote: string | null;
}

export interface AgentStep {
  at: string;
  text: string;
}

const PAGES_TTL_S = 30 * 60;
const RUN_TTL_S = 24 * 3600;
const MAX_STEPS = 40;
/** The agent may ask the API to read this many companies per run (the brief's per-run rate limit). */
export const MAX_AGENT_FETCHES_PER_RUN = 60;

/**
 * Short-lived working data of an agent-driven Discover run (T10), in Redis:
 *  - the pages the API served to the agent, so the API can check the agent's quotes against the SAME
 *    text without fetching again;
 *  - the agent's claims per company;
 *  - the steps shown in the Discover run header;
 *  - the per-run count of page fetches (the rate limit).
 * Everything fails soft: with Redis down a page is simply fetched again, steps are not shown, and
 * the rate limit falls back to a counter in this process.
 */
@Injectable()
export class DiscoverRunCache implements OnModuleDestroy {
  private readonly logger = new Logger(DiscoverRunCache.name);
  private redis: Redis | null = null;
  private readonly memCounts = new Map<string, number>();

  constructor(private readonly config: ConfigService) {}

  async onModuleDestroy() {
    await this.redis?.quit().catch(() => undefined);
  }

  private client(): Redis {
    if (!this.redis) {
      this.redis = new Redis(
        this.config.get<string>('REDIS_URL', 'redis://localhost:6379'),
        // short timeouts: a slow Redis means "no cache", never a slow search
        { maxRetriesPerRequest: 1, commandTimeout: 800, lazyConnect: true },
      );
      this.redis.on('error', (e: Error) =>
        this.logger.warn(`discover cache redis: ${e.message}`),
      );
    }
    return this.redis;
  }

  private key(runId: string, kind: string, extra = ''): string {
    const prefix = process.env.QUEUE_PREFIX || 'bull';
    return `${prefix}:discover:${kind}:${runId}${extra ? `:${extra}` : ''}`;
  }

  async setPages(runId: string, domain: string, v: CachedPages) {
    try {
      await this.client().set(
        this.key(runId, 'pages', domain),
        JSON.stringify(v),
        'EX',
        PAGES_TTL_S,
      );
    } catch {
      /* miss next time */
    }
  }

  async getPages(runId: string, domain: string): Promise<CachedPages | null> {
    try {
      const raw = await this.client().get(this.key(runId, 'pages', domain));
      return raw ? (JSON.parse(raw) as CachedPages) : null;
    } catch {
      return null;
    }
  }

  async setClaims(runId: string, claims: DiscoverCandidate[]) {
    if (claims.length === 0) return;
    try {
      const c = this.client();
      const key = this.key(runId, 'claims');
      const pipeline = c.pipeline();
      for (const cl of claims) {
        pipeline.hset(key, cl.domain.toLowerCase(), JSON.stringify(cl));
      }
      pipeline.expire(key, RUN_TTL_S);
      await pipeline.exec();
    } catch {
      /* the run falls back to the API's own AI analysis */
    }
  }

  async getClaim(
    runId: string,
    domain: string,
  ): Promise<DiscoverCandidate | null> {
    try {
      const raw = await this.client().hget(
        this.key(runId, 'claims'),
        domain.toLowerCase(),
      );
      return raw ? (JSON.parse(raw) as DiscoverCandidate) : null;
    } catch {
      return null;
    }
  }

  async pushStep(runId: string, text: string) {
    try {
      const c = this.client();
      const key = this.key(runId, 'steps');
      await c
        .pipeline()
        .rpush(key, JSON.stringify({ at: new Date().toISOString(), text }))
        .ltrim(key, -MAX_STEPS, -1)
        .expire(key, RUN_TTL_S)
        .exec();
    } catch {
      /* steps are a nicety */
    }
  }

  async steps(runId: string): Promise<AgentStep[]> {
    try {
      const raw = await this.client().lrange(this.key(runId, 'steps'), 0, -1);
      return raw.map((r) => JSON.parse(r) as AgentStep);
    } catch {
      return [];
    }
  }

  /** Counts one page fetch for this run; returns the new total. */
  async countFetch(runId: string): Promise<number> {
    try {
      const c = this.client();
      const key = this.key(runId, 'fetches');
      const n = await c.incr(key);
      if (n === 1) await c.expire(key, RUN_TTL_S);
      return n;
    } catch {
      const n = (this.memCounts.get(runId) ?? 0) + 1;
      this.memCounts.set(runId, n);
      return n;
    }
  }
}
