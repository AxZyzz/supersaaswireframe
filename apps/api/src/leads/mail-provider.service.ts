import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Inject, Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Job, Queue } from 'bullmq';
import Redis from 'ioredis';
import { Pool } from 'pg';
import { PG_POOL } from '../db/db.module';
import { withOrgContext } from '../db/tenant-context';
import { MAIL_PROVIDER_QUEUE, WORKER_OPTIONS } from '../queue/queue.module';
import type { MailProvider } from './attributes';
import { emailDomain } from './company-key';
import { MailProviderCache, MailProviderResolver } from './mail-provider';

const BATCH = 500;
const MAX_BATCHES_PER_JOB = 20;
const DNS_CONCURRENCY = 8;

/** Domain -> provider cache in Redis (7-day TTL), shared by every instance. */
class RedisMailProviderCache implements MailProviderCache {
  private redis: Redis | null = null;
  constructor(
    private readonly config: ConfigService,
    private readonly logger: Logger,
  ) {}
  private client() {
    if (!this.redis) {
      this.redis = new Redis(
        this.config.get<string>('REDIS_URL', 'redis://localhost:6379'),
        // short timeouts: a slow Redis means "cache miss", never a stuck job
        { maxRetriesPerRequest: 1, commandTimeout: 500, lazyConnect: true },
      );
      this.redis.on('error', (e: Error) =>
        this.logger.warn(`mail-provider cache redis: ${e.message}`),
      );
    }
    return this.redis;
  }
  get(key: string) {
    return this.client().get(key);
  }
  async set(key: string, value: string, ttlSeconds: number) {
    await this.client().set(key, value, 'EX', ttlSeconds);
  }
  async close() {
    await this.redis?.quit().catch(() => undefined);
  }
}

@Injectable()
export class MailProviderService implements OnModuleDestroy {
  private readonly logger = new Logger(MailProviderService.name);
  private readonly cache: RedisMailProviderCache;
  /** Swappable in tests (mock DNS + in-memory cache). */
  resolver: MailProviderResolver;
  /** Tests don't queue background work unless a test turns this on. */
  enqueueInTests = false;

  constructor(
    config: ConfigService,
    @Inject(PG_POOL) private readonly pool: Pool,
    @InjectQueue(MAIL_PROVIDER_QUEUE) private readonly queue: Queue,
  ) {
    this.cache = new RedisMailProviderCache(config, this.logger);
    this.resolver = new MailProviderResolver(this.cache);
  }

  async onModuleDestroy() {
    await this.cache.close();
  }

  /** Provider of one domain (cached). Used inline by Discover. */
  lookupDomain(domain: string): Promise<MailProvider> {
    return this.resolver.lookup(domain);
  }

  /**
   * Ask for this org's un-labelled leads to be filled in the background. One
   * pending job per org (jobId dedupes), never inside the caller's request.
   */
  async enqueue(orgId: string): Promise<void> {
    if (process.env.NODE_ENV === 'test' && !this.enqueueInTests) return;
    try {
      await this.queue.add(
        'fill',
        { orgId },
        {
          jobId: `mp-${orgId}`,
          removeOnComplete: true,
          removeOnFail: 20,
          attempts: 2,
          backoff: { type: 'exponential', delay: 30_000 },
        },
      );
    } catch (e) {
      // the label is a nice-to-have; never fail a lead write over it
      this.logger.warn(
        `could not queue mail-provider fill for ${orgId}: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  /**
   * Label leads that have an email but no provider yet. DNS runs outside any
   * DB transaction; distinct domains are looked up once each (cached).
   * Returns how many leads were labelled.
   */
  async fillOrg(orgId: string): Promise<number> {
    let total = 0;
    for (let i = 0; i < MAX_BATCHES_PER_JOB; i++) {
      const rows = await withOrgContext(
        this.pool,
        orgId,
        async (c) =>
          (
            await c.query<{ id: string; email: string }>(
              `SELECT id, email FROM leads
              WHERE mail_provider IS NULL AND email IS NOT NULL
              ORDER BY created_at LIMIT ${BATCH}`,
            )
          ).rows,
      );
      if (!rows.length) break;

      const domains = new Map<string, string[]>(); // domain -> lead ids
      const noDomain: string[] = [];
      for (const r of rows) {
        const d = emailDomain(r.email);
        if (!d) noDomain.push(r.id);
        else domains.set(d, [...(domains.get(d) ?? []), r.id]);
      }

      const byProvider = new Map<MailProvider, string[]>();
      if (noDomain.length) byProvider.set('unknown', noDomain);
      const list = [...domains.keys()];
      let next = 0;
      const worker = async () => {
        while (next < list.length) {
          const d = list[next++];
          const p = await this.resolver.lookup(d);
          byProvider.set(p, [...(byProvider.get(p) ?? []), ...domains.get(d)!]);
        }
      };
      await Promise.all(
        Array.from({ length: Math.min(DNS_CONCURRENCY, list.length) }, worker),
      );

      await withOrgContext(this.pool, orgId, async (c) => {
        for (const [provider, ids] of byProvider) {
          await c.query(
            `UPDATE leads SET mail_provider = $2 WHERE id = ANY($1::uuid[])
               AND mail_provider IS NULL`,
            [ids, provider],
          );
        }
      });
      total += rows.length;
      if (rows.length < BATCH) break;
    }
    return total;
  }
}

/** Runs the background fill (one org per job). */
@Processor(MAIL_PROVIDER_QUEUE, WORKER_OPTIONS)
export class MailProviderProcessor extends WorkerHost {
  constructor(private readonly mail: MailProviderService) {
    super();
  }
  async process(job: Job<{ orgId: string }>): Promise<number> {
    return this.mail.fillOrg(job.data.orgId);
  }
}
