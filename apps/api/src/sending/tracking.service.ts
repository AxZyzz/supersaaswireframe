import { Inject, Injectable, Logger } from '@nestjs/common';
import { Pool } from 'pg';
import { PG_POOL } from '../db/db.module';
import { withOrgContext } from '../db/tenant-context';
import { botReason } from './bot-detect';

interface TrackingRef {
  sent_email_id: string;
  org_id: string;
  campaign_id: string | null;
  lead_id: string | null;
}

type Tx = Parameters<Parameters<typeof withOrgContext>[2]>[0];

interface UnsubRef {
  campaign_lead_id: string;
  org_id: string;
  campaign_id: string;
  lead_id: string;
  email: string | null;
}

// Records open/click/unsubscribe events driven by the public tracking endpoints.
// Each opaque token is resolved to its owning org through a SECURITY DEFINER
// function (the tokens are unguessable UUIDs acting as bearer capabilities),
// then the write happens under that org's RLS context like any other mutation.
@Injectable()
export class TrackingService {
  private readonly logger = new Logger(TrackingService.name);

  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  private async resolveTracking(
    trackingId: string,
  ): Promise<TrackingRef | null> {
    const r = await this.pool.query<TrackingRef>(
      `SELECT sent_email_id, org_id, campaign_id, lead_id
       FROM resolve_tracking($1)`,
      [trackingId],
    );
    return r.rows[0] ?? null;
  }

  private async resolveUnsub(token: string): Promise<UnsubRef | null> {
    const r = await this.pool.query<UnsubRef>(
      `SELECT campaign_lead_id, org_id, campaign_id, lead_id, email
       FROM resolve_unsub($1)`,
      [token],
    );
    return r.rows[0] ?? null;
  }

  /**
   * Scanner/prefetch hits are kept as bot_open / bot_click (auditable) but
   * never count as engagement: no stats, no step gates, no timeline entry.
   */
  private async logIfBot(
    c: Tx,
    t: TrackingRef,
    kind: 'open' | 'click',
    userAgent: string | undefined,
    extra: Record<string, unknown> = {},
  ): Promise<boolean> {
    const se = await c.query<{ sent_at: Date }>(
      `SELECT sent_at FROM sent_emails WHERE id = $1`,
      [t.sent_email_id],
    );
    const reason = botReason(userAgent, se.rows[0]?.sent_at ?? null);
    if (!reason) return false;
    await c.query(
      `INSERT INTO email_events (org_id, sent_email_id, campaign_id, lead_id, type, data)
       VALUES ($1,$2,$3,$4,$5,$6::jsonb)`,
      [
        t.org_id,
        t.sent_email_id,
        t.campaign_id,
        t.lead_id,
        `bot_${kind}`,
        JSON.stringify({
          ...extra,
          reason,
          ua: (userAgent ?? '').slice(0, 200),
        }),
      ],
    );
    return true;
  }

  async recordOpen(trackingId: string, userAgent?: string): Promise<void> {
    const t = await this.resolveTracking(trackingId);
    if (!t) return;
    await withOrgContext(this.pool, t.org_id, async (c) => {
      if (await this.logIfBot(c, t, 'open', userAgent)) return;
      await c.query(
        `INSERT INTO email_events (org_id, sent_email_id, campaign_id, lead_id, type, data)
         VALUES ($1,$2,$3,$4,'open','{}'::jsonb)`,
        [t.org_id, t.sent_email_id, t.campaign_id, t.lead_id],
      );
      // Mirror the first open onto the lead's activity timeline (not every pixel
      // hit — mail clients refetch, and the timeline should read cleanly).
      if (t.lead_id) {
        await c.query(
          `INSERT INTO lead_events (org_id, lead_id, type, data)
           SELECT $1,$2,'email_opened','{}'::jsonb
           WHERE NOT EXISTS (
             SELECT 1 FROM lead_events WHERE lead_id = $2 AND type = 'email_opened'
           )`,
          [t.org_id, t.lead_id],
        );
      }
    });
  }

  async recordClick(
    trackingId: string,
    url: string,
    userAgent?: string,
  ): Promise<void> {
    const t = await this.resolveTracking(trackingId);
    if (!t) return;
    await withOrgContext(this.pool, t.org_id, async (c) => {
      if (await this.logIfBot(c, t, 'click', userAgent, { url })) return;
      await c.query(
        `INSERT INTO email_events (org_id, sent_email_id, campaign_id, lead_id, type, data)
         VALUES ($1,$2,$3,$4,'click',$5::jsonb)`,
        [
          t.org_id,
          t.sent_email_id,
          t.campaign_id,
          t.lead_id,
          JSON.stringify({ url }),
        ],
      );
      // A click implies an open — synthesize one if the pixel never fired (image
      // blocking) so condition gates and open stats stay consistent.
      await c.query(
        `INSERT INTO email_events (org_id, sent_email_id, campaign_id, lead_id, type, data)
         SELECT $1,$2,$3,$4,'open','{}'::jsonb
         WHERE NOT EXISTS (
           SELECT 1 FROM email_events
           WHERE sent_email_id = $2 AND type = 'open'
         )`,
        [t.org_id, t.sent_email_id, t.campaign_id, t.lead_id],
      );
      if (t.lead_id) {
        await c.query(
          `INSERT INTO lead_events (org_id, lead_id, type, data)
           SELECT $1,$2,'email_clicked',$3::jsonb
           WHERE NOT EXISTS (
             SELECT 1 FROM lead_events WHERE lead_id = $2 AND type = 'email_clicked'
           )`,
          [t.org_id, t.lead_id, JSON.stringify({ url })],
        );
      }
    });
  }

  // Suppress the recipient org-wide (so every campaign stops emailing them) and
  // stop this specific enrollment. Idempotent: re-hitting the link is a no-op.
  async unsubscribe(
    token: string,
  ): Promise<{ ok: boolean; email: string | null }> {
    const u = await this.resolveUnsub(token);
    if (!u) return { ok: false, email: null };
    await withOrgContext(this.pool, u.org_id, async (c) => {
      if (u.email) {
        await c.query(
          `INSERT INTO suppression_list (org_id, email, reason)
           VALUES ($1,$2,'unsubscribed')
           ON CONFLICT (org_id, lower(email)) DO NOTHING`,
          [u.org_id, u.email],
        );
      }
      await c.query(
        `UPDATE campaign_leads
         SET status = 'stopped', stop_reason = 'unsubscribed',
             next_send_at = NULL, updated_at = now()
         WHERE id = $1 AND status = 'active'`,
        [u.campaign_lead_id],
      );
      await c.query(
        `INSERT INTO email_events (org_id, campaign_id, lead_id, type, data)
         VALUES ($1,$2,$3,'unsubscribe','{}'::jsonb)`,
        [u.org_id, u.campaign_id, u.lead_id],
      );
      await c.query(
        `INSERT INTO lead_events (org_id, lead_id, type, data)
         VALUES ($1,$2,'unsubscribed','{}'::jsonb)`,
        [u.org_id, u.lead_id],
      );
    });
    return { ok: true, email: u.email };
  }
}
