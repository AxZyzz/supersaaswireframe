import { ForbiddenException, Inject, Injectable } from '@nestjs/common';
import { Pool, PoolClient } from 'pg';
import { PG_POOL } from '../db/db.module';
import { withOrgContext } from '../db/tenant-context';
import {
  AI_GENERATION_FEATURE,
  Plan,
  PLAN_LIMITS,
  PlanLimits,
  Resource,
  RESOURCE_LABELS,
} from './plan-limits';

/** 403 with a machine-readable code so clients can tell a quota from a role. */
export class LimitReachedException extends ForbiddenException {
  constructor(resource: Resource, limit: number) {
    super({
      statusCode: 403,
      error: 'Limit reached',
      code: 'LIMIT_REACHED',
      resource,
      limit,
      message: `Your workspace has reached its limit of ${limit.toLocaleString('en-US')} ${RESOURCE_LABELS[resource]}.`,
    });
  }
}

export interface UsageItem {
  key: Resource;
  label: string;
  used: number;
  limit: number | null;
}

// Org-wide counters. stepsPerCampaign is per campaign, so it's checked at
// the call site rather than summarised here.
const COUNTS: Record<Exclude<Resource, 'stepsPerCampaign'>, string> = {
  leads: `SELECT count(*)::int AS n FROM leads`,
  activeCampaigns: `SELECT count(*)::int AS n FROM campaigns
                    WHERE status IN ('active', 'scheduled')`,
  senders: `SELECT count(*)::int AS n FROM sender_accounts`,
  // Seats count pending invites, or invites could be handed out without bound.
  members: `SELECT (SELECT count(*) FROM memberships)
                 + (SELECT count(*) FROM invites
                    WHERE accepted_at IS NULL AND expires_at > now()) AS n`,
  emailsPerDay: `SELECT count(*)::int AS n FROM sent_emails
                 WHERE status = 'sent' AND sent_at >= date_trunc('day', now())`,
  emailsPerMonth: `SELECT count(*)::int AS n FROM sent_emails
                   WHERE status = 'sent' AND sent_at >= date_trunc('month', now())`,
  aiGenerationsPerMonth: `SELECT count(*)::int AS n FROM ai_usage
                          WHERE feature = '${AI_GENERATION_FEATURE}'
                            AND created_at >= date_trunc('month', now())`,
};

/**
 * Plan-limit enforcement. Every method takes the caller's transaction client
 * (already under the org's RLS context) so the check and the write commit
 * together. assertCanAdd() takes a per-org, per-resource advisory lock, so two
 * concurrent creates can't both squeeze through the last slot.
 */
@Injectable()
export class UsageService {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  async limits(c: PoolClient, orgId: string): Promise<PlanLimits> {
    const r = await c.query<{ plan: Plan }>(
      `SELECT plan FROM orgs WHERE id = $1`,
      [orgId],
    );
    return PLAN_LIMITS[r.rows[0]?.plan ?? 'beta'] ?? PLAN_LIMITS.beta;
  }

  async count(
    c: PoolClient,
    resource: Exclude<Resource, 'stepsPerCampaign'>,
  ): Promise<number> {
    const r = await c.query<{ n: number }>(COUNTS[resource]);
    return Number(r.rows[0]?.n ?? 0);
  }

  /** Throws LimitReachedException if adding `n` would exceed the plan. */
  async assertCanAdd(
    c: PoolClient,
    orgId: string,
    resource: Exclude<Resource, 'stepsPerCampaign'>,
    n = 1,
  ) {
    const limit = (await this.limits(c, orgId))[resource];
    if (limit === null) return;
    await c.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [
      `${orgId}:${resource}`,
    ]);
    if ((await this.count(c, resource)) + n > limit) {
      throw new LimitReachedException(resource, limit);
    }
  }

  /** Remaining headroom (Infinity when unlimited). Takes the same lock, for
   *  bulk paths like CSV import that consume the budget row by row. */
  async remaining(
    c: PoolClient,
    orgId: string,
    resource: Exclude<Resource, 'stepsPerCampaign'>,
  ): Promise<number> {
    const limit = (await this.limits(c, orgId))[resource];
    if (limit === null) return Infinity;
    await c.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [
      `${orgId}:${resource}`,
    ]);
    return Math.max(0, limit - (await this.count(c, resource)));
  }

  async assertSteps(c: PoolClient, orgId: string, total: number) {
    const limit = (await this.limits(c, orgId)).stepsPerCampaign;
    if (limit !== null && total > limit) {
      throw new LimitReachedException('stepsPerCampaign', limit);
    }
  }

  /** True when either email cap is used up — sends defer, never drop. */
  async emailCapReached(c: PoolClient, orgId: string): Promise<boolean> {
    const l = await this.limits(c, orgId);
    if (
      l.emailsPerDay !== null &&
      (await this.count(c, 'emailsPerDay')) >= l.emailsPerDay
    ) {
      return true;
    }
    return (
      l.emailsPerMonth !== null &&
      (await this.count(c, 'emailsPerMonth')) >= l.emailsPerMonth
    );
  }

  summary(orgId: string) {
    return withOrgContext(this.pool, orgId, async (c) => {
      const plan = (
        await c.query<{ plan: Plan }>(`SELECT plan FROM orgs WHERE id = $1`, [
          orgId,
        ])
      ).rows[0]?.plan;
      const limits = PLAN_LIMITS[plan ?? 'beta'];
      const items: UsageItem[] = [];
      for (const key of Object.keys(COUNTS) as (keyof typeof COUNTS)[]) {
        items.push({
          key,
          label: RESOURCE_LABELS[key],
          used: await this.count(c, key),
          limit: limits[key],
        });
      }
      return {
        plan: plan ?? 'beta',
        items,
        stepsPerCampaign: limits.stepsPerCampaign,
      };
    });
  }
}
