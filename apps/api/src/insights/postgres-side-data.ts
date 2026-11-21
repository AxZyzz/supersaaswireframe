import { Inject, Injectable } from '@nestjs/common';
import { Pool, PoolClient } from 'pg';
import { PG_POOL } from '../db/db.module';
import { withOrgContext } from '../db/tenant-context';
import { type InsightProspect, unknownIfEmpty } from './aggregate-insights';
import type { InsightsQuery } from './types';

/**
 * The few Insights facts that stay in Postgres even when the numbers come from
 * BigQuery (Learning Loop T07):
 *  - the Discover funnel's "eligible" count needs the prospects' email list,
 *    and we never copy emails to BigQuery;
 *  - the workspace timezone (a one-row lookup);
 *  - sender mailbox labels (the BigQuery copy only has sender ids).
 * All of it is read inside one tenant (RLS) context.
 */

export async function loadProspects(
  c: PoolClient,
  q: InsightsQuery,
): Promise<InsightProspect[]> {
  const pr = await c.query<{
    country: string | null;
    region: string | null;
    city: string | null;
    industry: string | null;
    size_band: string | null;
    trigger: string | null;
    eligible: boolean;
  }>(
    `SELECT p.country, p.region, p.city, p.industry, p.size_band,
            p.triggers->0->>'type' AS trigger,
            EXISTS (SELECT 1 FROM jsonb_array_elements(p.emails) e
                     WHERE (e->>'mx')::boolean) AS eligible
       FROM prospects p
       JOIN prospect_runs r ON r.id = p.run_id
      WHERE p.status = 'verified'
        AND ($1::uuid IS NULL OR r.offer_id = $1)
        AND ($2::timestamptz IS NULL OR p.created_at >= $2)
        AND ($3::timestamptz IS NULL OR p.created_at < $3)`,
    // (no campaign filter here: prospects belong to an offer, not a campaign)
    [q.offerId ?? null, q.from ?? null, q.to ?? null],
  );
  return pr.rows.map((p) => ({
    country: unknownIfEmpty(p.country),
    region: unknownIfEmpty(p.region),
    city: unknownIfEmpty(p.city),
    industry: unknownIfEmpty(p.industry),
    size_band: unknownIfEmpty(p.size_band),
    trigger: unknownIfEmpty(p.trigger),
    eligible: p.eligible,
  }));
}

export async function loadWorkspaceTz(
  c: PoolClient,
  orgId: string,
): Promise<string> {
  const org = await c.query<{ timezone: string | null }>(
    `SELECT timezone FROM orgs WHERE id = $1`,
    [orgId],
  );
  return org.rows[0]?.timezone || 'UTC';
}

export interface InsightsSideData {
  workspaceTz: string;
  prospects: InsightProspect[];
  /** sender_accounts.id -> mailbox address, for the "Sender mailbox" factor. */
  senderEmails: Map<string, string>;
}

/** Where a BigQuery-backed Insights source gets what it must not copy to BigQuery. */
export interface InsightsSideDataReader {
  read(q: InsightsQuery): Promise<InsightsSideData>;
}

export const INSIGHTS_SIDE_DATA = 'INSIGHTS_SIDE_DATA';

@Injectable()
export class PostgresSideData implements InsightsSideDataReader {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  read(q: InsightsQuery): Promise<InsightsSideData> {
    return withOrgContext(this.pool, q.orgId, async (c) => {
      // one client = one query at a time
      const workspaceTz = await loadWorkspaceTz(c, q.orgId);
      const prospects = await loadProspects(c, q);
      const senders = await c.query<{ id: string; from_email: string | null }>(
        `SELECT id, from_email FROM sender_accounts`,
      );
      return {
        workspaceTz,
        prospects,
        senderEmails: new Map(
          senders.rows
            .filter((s) => !!s.from_email)
            .map((s) => [s.id, s.from_email as string]),
        ),
      };
    });
  }
}
