import { Inject, Injectable } from '@nestjs/common';
import { Pool } from 'pg';
import { PG_POOL } from '../db/db.module';
import { withOrgContext } from '../db/tenant-context';
import { RESOURCE_LABELS } from '../usage/plan-limits';
import { UsageService } from '../usage/usage.service';

// Org-wide analytics, computed live from the E2/E4/E5 tables (leads, campaigns,
// sent_emails, email_events, lead_events). Beta data volumes are small, so
// on-the-fly aggregation is fine; a daily-rollup worker is a later optimization.
// Engagement rates use per-email counts (distinct sent_email with an event),
// the standard open/click-rate definition.

export interface Overview {
  leads: { total: number; new7: number };
  campaigns: { total: number; active: number };
  sent: { total: number; last7: number };
  engagement: {
    opened: number;
    clicked: number;
    replied: number;
    unsubscribed: number;
    bounced: number;
  };
  activity: {
    type: string;
    createdAt: string;
    lead: string;
  }[];
  // Actionable warnings surfaced on the dashboard.
  alerts: {
    kind: 'sender_unverified' | 'sender_near_limit' | 'usage_near_limit';
    message: string;
  }[];
}

export interface CampaignAnalyticsRow {
  id: string;
  name: string;
  status: string;
  enrolled: number;
  sent: number;
  opened: number;
  clicked: number;
  unsubscribed: number;
}

@Injectable()
export class AnalyticsService {
  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    private readonly usage: UsageService,
  ) {}

  overview(orgId: string): Promise<Overview> {
    return withOrgContext(this.pool, orgId, async (c) => {
      const leads = await c.query<{ total: number; new7: number }>(
        `SELECT count(*)::int AS total,
           count(*) FILTER (WHERE created_at > now() - interval '7 days')::int AS new7
         FROM leads`,
      );
      const campaigns = await c.query<{ total: number; active: number }>(
        `SELECT count(*)::int AS total,
           count(*) FILTER (WHERE status = 'active')::int AS active
         FROM campaigns`,
      );
      const sent = await c.query<{ total: number; last7: number }>(
        `SELECT count(*)::int AS total,
           count(*) FILTER (WHERE sent_at > now() - interval '7 days')::int AS last7
         FROM sent_emails WHERE status = 'sent'`,
      );
      const eng = await c.query<{
        opened: number;
        clicked: number;
        replied: number;
        unsubscribed: number;
        bounced: number;
      }>(
        `SELECT
           count(DISTINCT sent_email_id) FILTER (WHERE type = 'open')::int AS opened,
           count(DISTINCT sent_email_id) FILTER (WHERE type = 'click')::int AS clicked,
           count(DISTINCT lead_id) FILTER (WHERE type = 'reply')::int AS replied,
           count(*) FILTER (WHERE type = 'unsubscribe')::int AS unsubscribed,
           count(*) FILTER (WHERE type IN ('bounce','failed'))::int AS bounced
         FROM email_events`,
      );
      const activity = await c.query<{
        type: string;
        created_at: Date;
        lead: string | null;
      }>(
        `SELECT le.type, le.created_at,
           COALESCE(NULLIF(trim(concat_ws(' ', l.first_name, l.last_name)), ''), l.email, l.company) AS lead
         FROM lead_events le
         JOIN leads l ON l.id = le.lead_id
         ORDER BY le.created_at DESC
         LIMIT 12`,
      );

      // Senders not yet verified, and senders at >= 80% of today's daily limit.
      const senders = await c.query<{
        from_email: string;
        status: string;
        daily_limit: number;
        sent_today: number;
      }>(
        `SELECT s.from_email, s.status, s.daily_limit,
           (SELECT count(*)::int FROM sent_emails se
             WHERE se.sender_id = s.id AND se.status = 'sent'
               AND se.sent_at::date = current_date) AS sent_today
         FROM sender_accounts s ORDER BY s.created_at`,
      );
      const alerts: Overview['alerts'] = [];
      for (const s of senders.rows) {
        if (s.status !== 'verified') {
          alerts.push({
            kind: 'sender_unverified',
            message: `${s.from_email} is not verified`,
          });
        }
        if (s.daily_limit > 0 && s.sent_today >= s.daily_limit * 0.8) {
          alerts.push({
            kind: 'sender_near_limit',
            message: `${s.from_email} near daily limit (${s.sent_today}/${s.daily_limit})`,
          });
        }
      }

      // Plan limits at 80%+ — warn before something gets blocked or deferred.
      const limits = await this.usage.limits(c, orgId);
      for (const key of [
        'leads',
        'activeCampaigns',
        'senders',
        'members',
        'emailsPerDay',
        'emailsPerMonth',
        'aiGenerationsPerMonth',
      ] as const) {
        const limit = limits[key];
        if (limit === null) continue;
        const used = await this.usage.count(c, key);
        if (used >= limit * 0.8) {
          alerts.push({
            kind: 'usage_near_limit',
            message: `${used >= limit ? 'At' : 'Near'} plan limit: ${used.toLocaleString('en-US')}/${limit.toLocaleString('en-US')} ${RESOURCE_LABELS[key]}`,
          });
        }
      }

      return {
        alerts,
        leads: leads.rows[0],
        campaigns: campaigns.rows[0],
        sent: sent.rows[0],
        engagement: eng.rows[0],
        activity: activity.rows.map((r) => ({
          type: r.type,
          createdAt: r.created_at.toISOString(),
          lead: r.lead ?? 'Unknown lead',
        })),
      };
    });
  }

  campaigns(orgId: string): Promise<CampaignAnalyticsRow[]> {
    return withOrgContext(this.pool, orgId, async (c) => {
      const res = await c.query<CampaignAnalyticsRow>(
        `SELECT c.id, c.name, c.status,
           (SELECT count(*)::int FROM campaign_leads cl WHERE cl.campaign_id = c.id) AS enrolled,
           (SELECT count(*)::int FROM sent_emails se WHERE se.campaign_id = c.id AND se.status = 'sent') AS sent,
           (SELECT count(DISTINCT e.sent_email_id)::int FROM email_events e WHERE e.campaign_id = c.id AND e.type = 'open') AS opened,
           (SELECT count(DISTINCT e.sent_email_id)::int FROM email_events e WHERE e.campaign_id = c.id AND e.type = 'click') AS clicked,
           (SELECT count(*)::int FROM email_events e WHERE e.campaign_id = c.id AND e.type = 'unsubscribe') AS unsubscribed
         FROM campaigns c
         ORDER BY c.created_at DESC`,
      );
      return res.rows;
    });
  }
}
