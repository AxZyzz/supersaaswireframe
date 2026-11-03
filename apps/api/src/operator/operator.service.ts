import { InjectQueue } from '@nestjs/bullmq';
import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { Queue } from 'bullmq';
import { Pool } from 'pg';
import { AppService } from '../app.service';
import { PG_POOL } from '../db/db.module';
import {
  CAMPAIGN_SEND_QUEUE,
  LEAD_IMPORT_QUEUE,
  SEGMENT_REFRESH_QUEUE,
} from '../queue/queue.module';
import type { Plan } from '../usage/plan-limits';

/**
 * Platform-wide reads for A2B operators. Every cross-tenant query goes through
 * a SECURITY DEFINER function (0034_operator.sql) that returns aggregates or
 * masked data — never raw lead records.
 */
@Injectable()
export class OperatorService {
  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    private readonly app: AppService,
    @InjectQueue(CAMPAIGN_SEND_QUEUE) private readonly sendQ: Queue,
    @InjectQueue(LEAD_IMPORT_QUEUE) private readonly importQ: Queue,
    @InjectQueue(SEGMENT_REFRESH_QUEUE) private readonly segmentQ: Queue,
  ) {}

  private async one<T>(sql: string, params: unknown[] = []) {
    return (await this.pool.query<T & Record<string, unknown>>(sql, params))
      .rows;
  }

  async overview() {
    const [totals] = await this.one(`SELECT * FROM operator_overview()`);
    const daily = await this.one(`SELECT * FROM operator_daily_sends()`);
    return { totals, daily };
  }

  orgs() {
    return this.one(`SELECT * FROM operator_orgs()`);
  }

  async org(id: string) {
    const [org] = await this.one<{ id: string }>(
      `SELECT * FROM operator_orgs() WHERE id = $1`,
      [id],
    );
    if (!org) throw new NotFoundException('Workspace not found');
    const members = await this.one(`SELECT * FROM operator_org_members($1)`, [
      id,
    ]);
    return { ...org, members };
  }

  failures(limit = 50) {
    return this.one(`SELECT * FROM operator_failures($1)`, [limit]);
  }

  async setPlan(id: string, plan: Plan) {
    const r = await this.one<{ operator_set_plan: boolean | null }>(
      `SELECT operator_set_plan($1, $2)`,
      [id, plan],
    );
    if (!r[0]?.operator_set_plan)
      throw new NotFoundException('Workspace not found');
    return { id, plan };
  }

  async health() {
    const queues: Record<string, Record<string, number>> = {};
    for (const [name, q] of [
      ['send', this.sendQ],
      ['import', this.importQ],
      ['segments', this.segmentQ],
    ] as const) {
      queues[name] = await q
        .getJobCounts('waiting', 'active', 'delayed', 'failed')
        .catch(() => ({}));
    }
    return {
      readiness: await this.app.ready(),
      queues,
      uptimeSeconds: Math.round(process.uptime()),
      node: process.version,
      env: process.env.NODE_ENV ?? 'development',
    };
  }
}
