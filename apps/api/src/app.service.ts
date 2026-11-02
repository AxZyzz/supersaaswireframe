import { InjectQueue } from '@nestjs/bullmq';
import { Inject, Injectable } from '@nestjs/common';
import { Queue } from 'bullmq';
import { Pool } from 'pg';
import { PG_POOL } from './db/db.module';
import { CAMPAIGN_SEND_QUEUE } from './queue/queue.module';

export interface Readiness {
  status: 'ok' | 'degraded';
  checks: { db: boolean; redis: boolean };
}

const withTimeout = <T>(p: Promise<T>, ms: number) =>
  Promise.race([
    p,
    new Promise<never>((_, rej) =>
      setTimeout(() => rej(new Error('timeout')), ms),
    ),
  ]);

@Injectable()
export class AppService {
  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    @InjectQueue(CAMPAIGN_SEND_QUEUE) private readonly queue: Queue,
  ) {}

  health(): { status: string } {
    return { status: 'ok' };
  }

  /** Liveness is `GET /`; this is readiness — can we serve real traffic? */
  async ready(): Promise<Readiness> {
    const [db, redis] = await Promise.all([
      withTimeout(this.pool.query('SELECT 1'), 2000).then(
        () => true,
        () => false,
      ),
      // any cheap command proves the Redis round trip
      withTimeout(this.queue.getJobCounts('waiting'), 2000).then(
        () => true,
        () => false,
      ),
    ]);
    return { status: db && redis ? 'ok' : 'degraded', checks: { db, redis } };
  }
}
