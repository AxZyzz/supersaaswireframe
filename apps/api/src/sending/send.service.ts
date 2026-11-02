import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';
import { Pool, PoolClient } from 'pg';
import { PG_POOL } from '../db/db.module';
import { withOrgContext } from '../db/tenant-context';
import { SendersService } from '../senders/senders.service';
import { varsFromLead } from '../templates/render';
import { buildEmail } from './send-render';
import { UsageService } from '../usage/usage.service';

type Outcome =
  'sent' | 'failed' | 'skipped' | 'deferred' | 'completed' | 'suppressed';

interface StepRow {
  id: string;
  template_id: string | null;
  delay_hours: number;
  condition: string;
  subject_variants: string[];
}

interface SenderRow {
  id: string;
  from_name: string;
  from_email: string;
  daily_limit: number;
  send_window_start: number | null;
  send_window_end: number | null;
}

@Injectable()
export class SendService {
  private readonly logger = new Logger(SendService.name);

  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    private readonly senders: SendersService,
    private readonly config: ConfigService,
    private readonly usage: UsageService,
  ) {}

  private get baseUrl(): string {
    return this.config.get<string>('API_URL', 'http://localhost:4000');
  }

  // Process all due sends (optionally for one org). Returns per-outcome counts.
  async tick(orgId?: string, max = 200): Promise<Record<Outcome, number>> {
    const due = await this.pool.query<{
      campaign_lead_id: string;
      org_id: string;
    }>(`SELECT campaign_lead_id, org_id FROM due_campaign_sends($1, $2)`, [
      max,
      orgId ?? null,
    ]);

    const counts: Record<Outcome, number> = {
      sent: 0,
      failed: 0,
      skipped: 0,
      deferred: 0,
      completed: 0,
      suppressed: 0,
    };
    for (const row of due.rows) {
      try {
        const outcome = await this.processLead(
          row.org_id,
          row.campaign_lead_id,
        );
        counts[outcome]++;
      } catch (err) {
        counts.failed++;
        this.logger.error(
          `send failed for lead ${row.campaign_lead_id}`,
          err as Error,
        );
      }
    }
    return counts;
  }

  private hourInWindow(
    start: number | null,
    end: number | null,
    hour: number,
  ): boolean {
    if (start == null || end == null) return true;
    if (start === end) return true;
    return start < end
      ? hour >= start && hour < end
      : hour >= start || hour < end;
  }

  private async hasEvent(
    c: PoolClient,
    campaignId: string,
    leadId: string,
    type: string,
  ): Promise<boolean> {
    const r = await c.query(
      `SELECT 1 FROM email_events WHERE campaign_id = $1 AND lead_id = $2 AND type = $3 LIMIT 1`,
      [campaignId, leadId, type],
    );
    return (r.rowCount ?? 0) > 0;
  }

  private conditionMet(
    condition: string,
    opened: boolean,
    replied: boolean,
  ): boolean {
    if (condition === 'opened_no_reply') return opened && !replied;
    if (condition === 'not_opened') return !opened;
    return true; // 'always'
  }

  // Advance the per-lead pointer to `newIndex`; schedule the next step or
  // complete the lead.
  private async advance(
    c: PoolClient,
    leadStateId: string,
    newIndex: number,
    steps: StepRow[],
  ) {
    if (newIndex < steps.length) {
      await c.query(
        `UPDATE campaign_leads
         SET current_step = $2, next_send_at = now() + make_interval(hours => $3),
             updated_at = now()
         WHERE id = $1`,
        [leadStateId, newIndex, steps[newIndex].delay_hours],
      );
    } else {
      await c.query(
        `UPDATE campaign_leads
         SET current_step = $2, status = 'completed', next_send_at = NULL,
             updated_at = now()
         WHERE id = $1`,
        [leadStateId, newIndex],
      );
    }
  }

  private async stop(c: PoolClient, leadStateId: string, reason: string) {
    await c.query(
      `UPDATE campaign_leads SET status = 'stopped', stop_reason = $2,
         next_send_at = NULL, updated_at = now() WHERE id = $1`,
      [leadStateId, reason],
    );
  }

  private async processLead(
    orgId: string,
    leadStateId: string,
  ): Promise<Outcome> {
    // Phase 1: load + decide (short read tx; no network held).
    const plan = await withOrgContext(this.pool, orgId, async (c) => {
      const clRes = await c.query<{
        id: string;
        campaign_id: string;
        lead_id: string;
        current_step: number;
        status: string;
        unsub_token: string;
      }>(
        `SELECT id, campaign_id, lead_id, current_step, status, unsub_token
         FROM campaign_leads WHERE id = $1`,
        [leadStateId],
      );
      if (clRes.rowCount === 0) return { outcome: 'skipped' as Outcome };
      const cl = clRes.rows[0];
      if (cl.status !== 'active') return { outcome: 'skipped' as Outcome };

      const campRes = await c.query<{ sender_ids: string[]; status: string }>(
        `SELECT sender_ids, status FROM campaigns WHERE id = $1`,
        [cl.campaign_id],
      );
      if (campRes.rowCount === 0) return { outcome: 'skipped' as Outcome };
      const campStatus = campRes.rows[0].status;
      if (campStatus !== 'active' && campStatus !== 'scheduled') {
        return { outcome: 'skipped' as Outcome };
      }
      // A scheduled campaign whose first send is now due becomes active.
      if (campStatus === 'scheduled') {
        await c.query(
          `UPDATE campaigns SET status = 'active',
             started_at = COALESCE(started_at, now()), updated_at = now()
           WHERE id = $1`,
          [cl.campaign_id],
        );
      }
      const senderIds = campRes.rows[0].sender_ids ?? [];

      const stepsRes = await c.query<StepRow>(
        `SELECT id, template_id, delay_hours, condition, subject_variants
         FROM campaign_steps WHERE campaign_id = $1 ORDER BY step_order`,
        [cl.campaign_id],
      );
      const steps = stepsRes.rows;
      const step = steps[cl.current_step];
      if (!step) {
        await this.advance(c, cl.id, cl.current_step, steps); // -> completed
        return { outcome: 'completed' as Outcome };
      }

      // A step with no template can't send — skip it.
      if (!step.template_id) {
        await this.advance(c, cl.id, cl.current_step + 1, steps);
        return { outcome: 'skipped' as Outcome };
      }

      const leadRes = await c.query<{
        email: string | null;
        first_name: string | null;
        last_name: string | null;
        company: string | null;
        title: string | null;
        phone: string | null;
      }>(
        `SELECT email, first_name, last_name, company, title, phone
         FROM leads WHERE id = $1`,
        [cl.lead_id],
      );
      if (leadRes.rowCount === 0) {
        await this.stop(c, cl.id, 'lead_deleted');
        return { outcome: 'skipped' as Outcome };
      }
      const lead = leadRes.rows[0];
      if (!lead.email) {
        await this.stop(c, cl.id, 'no_email');
        return { outcome: 'skipped' as Outcome };
      }

      // Suppression (unsubscribed / bounced / complained).
      const sup = await c.query(
        `SELECT 1 FROM suppression_list WHERE lower(email) = lower($1) LIMIT 1`,
        [lead.email],
      );
      if ((sup.rowCount ?? 0) > 0) {
        await this.stop(c, cl.id, 'suppressed');
        return { outcome: 'suppressed' as Outcome };
      }

      // Condition gate (events are empty until tracking/replies land; 'always'
      // sends, conditional steps that aren't satisfiable are skipped forward).
      if (step.condition !== 'always') {
        const opened = await this.hasEvent(
          c,
          cl.campaign_id,
          cl.lead_id,
          'open',
        );
        const replied = await this.hasEvent(
          c,
          cl.campaign_id,
          cl.lead_id,
          'reply',
        );
        if (!this.conditionMet(step.condition, opened, replied)) {
          await this.advance(c, cl.id, cl.current_step + 1, steps);
          return { outcome: 'skipped' as Outcome };
        }
      }

      // Plan email caps (per day / per month): defer, don't drop — the lead
      // stays due and goes out once the window resets.
      if (await this.usage.emailCapReached(c, orgId)) {
        return { outcome: 'deferred' as Outcome };
      }

      // Choose a sender: eligible = campaign's sender_ids (or all org senders),
      // within send window, with remaining daily capacity. Pick the most-free.
      const sendersRes = senderIds.length
        ? await c.query<SenderRow>(
            `SELECT id, from_name, from_email, daily_limit, send_window_start, send_window_end
             FROM sender_accounts WHERE id = ANY($1::uuid[])`,
            [senderIds],
          )
        : await c.query<SenderRow>(
            `SELECT id, from_name, from_email, daily_limit, send_window_start, send_window_end
             FROM sender_accounts ORDER BY created_at`,
          );
      const hour = new Date().getHours();
      let chosen: SenderRow | null = null;
      let bestRemaining = 0;
      for (const s of sendersRes.rows) {
        if (!this.hourInWindow(s.send_window_start, s.send_window_end, hour)) {
          continue;
        }
        const cnt = await c.query<{ n: number }>(
          `SELECT count(*)::int AS n FROM sent_emails
           WHERE sender_id = $1 AND status = 'sent' AND sent_at::date = current_date`,
          [s.id],
        );
        const remaining = s.daily_limit - cnt.rows[0].n;
        if (remaining > 0 && remaining > bestRemaining) {
          bestRemaining = remaining;
          chosen = s;
        }
      }
      if (!chosen) return { outcome: 'deferred' as Outcome }; // no capacity now

      // Template + A/B variant.
      const tplRes = await c.query<{ subject: string; body_html: string }>(
        `SELECT subject, body_html FROM templates WHERE id = $1`,
        [step.template_id],
      );
      if (tplRes.rowCount === 0) {
        await this.advance(c, cl.id, cl.current_step + 1, steps);
        return { outcome: 'skipped' as Outcome };
      }
      const tpl = tplRes.rows[0];

      let subject = tpl.subject;
      let variantIndex = 0;
      const variants = step.subject_variants ?? [];
      if (variants.length > 0) {
        const sentForStep = await c.query<{ n: number }>(
          `SELECT count(*)::int AS n FROM sent_emails WHERE step_id = $1`,
          [step.id],
        );
        variantIndex = sentForStep.rows[0].n % variants.length;
        subject = variants[variantIndex];
      }

      const vars = {
        ...varsFromLead(lead),
        sender_name: chosen.from_name,
      };
      // CAN-SPAM footer identity: workspace name + postal address.
      const org = await c.query<{
        name: string;
        postal_address: string | null;
      }>(`SELECT name, postal_address FROM orgs WHERE id = $1`, [orgId]);

      return {
        outcome: 'sent' as Outcome, // provisional; finalized in phase 3
        plan: {
          cl,
          steps,
          step,
          nextIndex: cl.current_step + 1,
          senderId: chosen.id,
          fromName: chosen.from_name,
          to: lead.email,
          subject,
          bodyHtml: tpl.body_html,
          vars,
          variantIndex,
          trackingId: randomUUID(),
          unsubToken: cl.unsub_token,
          sender: {
            name: org.rows[0]?.name ?? '',
            postalAddress: org.rows[0]?.postal_address ?? null,
          },
        },
      };
    });

    if (plan.outcome !== 'sent' || !('plan' in plan) || !plan.plan) {
      return plan.outcome;
    }
    const p = plan.plan;

    // Phase 2: build + send (no DB tx held during the network call).
    const email = buildEmail({
      subject: p.subject,
      bodyHtml: p.bodyHtml,
      vars: p.vars,
      baseUrl: this.baseUrl,
      trackingId: p.trackingId,
      unsubToken: p.unsubToken,
      sender: p.sender,
    });

    let messageId: string | null = null;
    let provider: string | null = null;
    let error: string | null = null;
    try {
      const res = await this.senders.sendMessage(orgId, p.senderId, {
        to: p.to,
        subject: email.subject,
        html: email.html,
        text: email.text,
        headers: {
          'List-Unsubscribe': email.listUnsubscribe,
          // RFC 8058 one-click: mail clients POST the unsub URL directly.
          'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
        },
      });
      messageId = res.messageId;
      provider = res.provider;
    } catch (err) {
      error = err instanceof Error ? err.message : 'send failed';
    }

    // Phase 3: record + advance.
    await withOrgContext(this.pool, orgId, async (c) => {
      const se = await c.query<{ id: string }>(
        `INSERT INTO sent_emails
           (org_id, campaign_id, campaign_lead_id, lead_id, step_id, sender_id,
            to_email, subject, message_id, provider, status, variant_index,
            tracking_id, error)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
         RETURNING id`,
        [
          orgId,
          p.cl.campaign_id,
          p.cl.id,
          p.cl.lead_id,
          p.step.id,
          p.senderId,
          p.to,
          email.subject,
          messageId,
          provider,
          error ? 'failed' : 'sent',
          p.variantIndex,
          p.trackingId,
          error,
        ],
      );
      await c.query(
        `INSERT INTO email_events (org_id, sent_email_id, campaign_id, lead_id, type, data)
         VALUES ($1,$2,$3,$4,$5,$6::jsonb)`,
        [
          orgId,
          se.rows[0].id,
          p.cl.campaign_id,
          p.cl.lead_id,
          error ? 'failed' : 'sent',
          JSON.stringify({ step: p.step.id, variant: p.variantIndex }),
        ],
      );
      // Mirror onto the lead's activity timeline.
      await c.query(
        `INSERT INTO lead_events (org_id, lead_id, type, data)
         VALUES ($1,$2,$3,$4::jsonb)`,
        [
          orgId,
          p.cl.lead_id,
          error ? 'email_failed' : 'email_sent',
          JSON.stringify({
            campaign_id: p.cl.campaign_id,
            subject: email.subject,
          }),
        ],
      );
      await this.advance(c, p.cl.id, p.nextIndex, p.steps);
    });

    return error ? 'failed' : 'sent';
  }
}
