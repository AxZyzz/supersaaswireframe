import { Inject, Injectable } from '@nestjs/common';
import { Pool } from 'pg';
import { PG_POOL } from '../db/db.module';
import { withOrgContext } from '../db/tenant-context';
import {
  aggregateInsights,
  type InsightCompany,
  type InsightProspect,
} from './aggregate-insights';
import { type CompanyRow, toInsightCompany } from './company-row';
import { loadProspects, loadWorkspaceTz } from './postgres-side-data';
import type {
  BucketRow,
  FactorId,
  GridRow,
  InsightsData,
  InsightsQuery,
  InsightsSource,
} from './types';

/**
 * Insights straight from Postgres: enrollment snapshots, step-1 sends, real
 * opens and the CURRENT outcomes, all inside one tenant (RLS) context. T07 adds
 * a BigQuery source that returns exactly these row shapes.
 *
 * A company is counted once (company_key), by its first step-1 email. Replies
 * and outcomes count only when they are tied to that company's enrollment in
 * that campaign (an unattributed reply cannot be credited to a factor).
 */
@Injectable()
export class PostgresInsightsSource implements InsightsSource {
  readonly name = 'postgres';

  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  async factorFunnel(q: InsightsQuery, factor: FactorId): Promise<BucketRow[]> {
    return (await this.all(q)).buckets[factor];
  }

  async sendTimeGrid(q: InsightsQuery): Promise<GridRow[]> {
    return (await this.all(q)).grid;
  }

  async all(q: InsightsQuery): Promise<InsightsData> {
    const { companies, prospects, workspaceTz } = await withOrgContext(
      this.pool,
      q.orgId,
      async (c) => {
        const params = [
          q.offerId ?? null,
          q.campaignIds && q.campaignIds.length > 0 ? q.campaignIds : null,
          q.from ?? null,
          q.to ?? null,
        ];
        const rows = await c.query<CompanyRow>(
          `WITH scope AS (
             SELECT cp.id AS campaign_id FROM campaigns cp
              WHERE ($1::uuid IS NULL OR cp.offer_id = $1)
                AND ($2::uuid[] IS NULL OR cp.id = ANY($2))
           ), sends AS (
             -- step_order here is the step's 1-based POSITION in its campaign (first step = 1).
             -- The app stores steps from 0, so the stored number can't be compared with 1 directly.
             SELECT se.id, se.campaign_id, se.step_id, se.sender_id, se.subject,
                    se.sent_at, se.variant_id,
                    s.step_order - fs.first_order + 1 AS step_order, s.template_id,
                    COALESCE(cl.snapshot->>'company_key', l.company_key) AS company_key,
                    cl.snapshot AS snap, l.id AS lead_id
               FROM sent_emails se
               JOIN scope ON scope.campaign_id = se.campaign_id
               JOIN campaign_steps s ON s.id = se.step_id
               JOIN (SELECT campaign_id, min(step_order) AS first_order
                       FROM campaign_steps GROUP BY campaign_id) fs
                 ON fs.campaign_id = se.campaign_id
               LEFT JOIN campaign_leads cl ON cl.id = se.campaign_lead_id
               LEFT JOIN leads l ON l.id = se.lead_id
              WHERE se.status = 'sent'
                AND ($3::timestamptz IS NULL OR se.sent_at >= $3)
                AND ($4::timestamptz IS NULL OR se.sent_at < $4)
           ), first_touch AS (
             SELECT DISTINCT ON (company_key) *
               FROM sends
              WHERE step_order = 1 AND company_key IS NOT NULL
              ORDER BY company_key, sent_at
           )
           SELECT ft.company_key, ft.sent_at AS first_sent, ft.snap,
                  l.city AS lead_city, l.region AS lead_region, l.country AS lead_country,
                  l.mail_provider AS lead_mail_provider, l.source AS lead_source,
                  l.title AS lead_title, sa.from_email AS sender_email,
                  ft.subject, t.subject AS template_subject, ev.label AS variant_label,
                  oc.bounced, oc.replied, oc.positive, oc.qualified, oc.booked,
                  oc.unsubscribed, oc.first_reply_at, rs.step_order AS reply_step,
                  EXISTS (
                    SELECT 1 FROM email_events e
                      JOIN sends s2 ON s2.id = e.sent_email_id
                     WHERE s2.company_key = ft.company_key
                       AND s2.campaign_id = ft.campaign_id
                       AND s2.step_order = 1 AND e.type = 'open'
                  ) AS opened
             FROM first_touch ft
             LEFT JOIN leads l ON l.id = ft.lead_id
             LEFT JOIN sender_accounts sa ON sa.id = ft.sender_id
             LEFT JOIN templates t ON t.id = ft.template_id
             LEFT JOIN experiment_variants ev ON ev.id = ft.variant_id
             LEFT JOIN LATERAL (
               SELECT bool_or(o.type = 'bounce') AS bounced,
                      bool_or(o.type = 'reply') AS replied,
                      bool_or(o.type = 'qualified_reply'
                              AND o.verification IN ('provisional','verified')) AS positive,
                      bool_or(o.type = 'qualified_reply'
                              AND o.verification = 'verified') AS qualified,
                      bool_or(o.type = 'booked_call'
                              AND o.verification = 'verified') AS booked,
                      bool_or(o.type = 'unsubscribe') AS unsubscribed,
                      min(o.occurred_at) FILTER (WHERE o.type = 'reply') AS first_reply_at,
                      (array_agg(o.sent_email_id ORDER BY o.occurred_at)
                         FILTER (WHERE o.type = 'reply'))[1] AS first_reply_email
                 FROM v_outcomes_current o
                 JOIN campaign_leads ocl ON ocl.id = o.campaign_lead_id
                WHERE o.company_key = ft.company_key AND ocl.campaign_id = ft.campaign_id
             ) oc ON true
             LEFT JOIN sends rs ON rs.id = oc.first_reply_email`,
          params,
        );

        const prospects: InsightProspect[] = await loadProspects(c, q);
        const workspaceTz = await loadWorkspaceTz(c, q.orgId);

        const companies: InsightCompany[] = rows.rows.map(toInsightCompany);

        return {
          companies,
          prospects,
          workspaceTz,
        };
      },
    );
    return aggregateInsights(companies, prospects, workspaceTz);
  }
}
