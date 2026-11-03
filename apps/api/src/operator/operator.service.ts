import { InjectQueue } from '@nestjs/bullmq';
import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { Queue } from 'bullmq';
import { Pool } from 'pg';
import { AppService } from '../app.service';
import { PG_POOL } from '../db/db.module';
import { withOrgContext } from '../db/tenant-context';
import { NotificationsService } from '../notifications/notifications.service';
import { RealtimeService } from '../realtime/realtime.service';
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
    private readonly notifications: NotificationsService,
    private readonly realtime: RealtimeService,
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

  /**
   * Incident brake (RUNBOOK §7, bounce/complaint spike): pause every active or
   * scheduled campaign in one workspace. Runs inside that workspace's RLS
   * context, the same write path as its own Pause button, and tells every
   * member why. The workspace resumes campaigns itself once it's fixed.
   */
  async pauseCampaigns(orgId: string, reason: string) {
    await this.org(orgId); // 404 for an unknown workspace
    const paused = await withOrgContext(this.pool, orgId, async (c) => {
      const r = await c.query<{ id: string }>(
        `UPDATE campaigns SET status = 'paused', updated_at = now()
         WHERE status IN ('active', 'scheduled') RETURNING id`,
      );
      if (r.rowCount) {
        await this.notifications.notifyOrg(c, orgId, {
          type: 'operator_pause',
          title: `A2B paused ${r.rowCount} campaign${r.rowCount === 1 ? '' : 's'}`,
          body: reason,
          link: '/campaigns',
        });
      }
      return r.rowCount ?? 0;
    });
    if (paused) {
      this.realtime.toOrg(orgId, { type: 'campaigns' });
      this.realtime.toOrg(orgId, { type: 'notifications' });
    }
    return { id: orgId, paused };
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
