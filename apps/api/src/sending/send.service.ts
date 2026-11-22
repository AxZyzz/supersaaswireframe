import { clickKey, signClick } from './link-signing';
import { GmailAuthError } from '../senders/providers/gmail.provider';
import {
  BeforeApplicationShutdown,
  Inject,
  Injectable,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';
import { Pool, PoolClient } from 'pg';
import { PG_POOL } from '../db/db.module';
import { withOrgContext } from '../db/tenant-context';
import { SendersService } from '../senders/senders.service';
import { varsFromLead, websiteUrl } from '../templates/render';
import { buildEmail } from './send-render';
import { UsageService } from '../usage/usage.service';
import { RealtimeService } from '../realtime/realtime.service';
import { effectiveLimitSql } from '../senders/warmup';
import {
  type AssignableVariant,
  pickExperimentVariant,
} from '../campaigns/experiment-assignment';
import { isValidTimeZone } from '../prospects/attributes';
import {
  parseSendWindow,
  scheduleInWindow,
  type SendWindow,
} from './send-window';

type Outcome =
  'sent' | 'failed' | 'skipped' | 'deferred' | 'completed' | 'suppressed';

interface StepRow {
  id: string;
  template_id: string | null;
  delay_hours: number;
  condition: string;
  subject_variants: string[];
  winner_index: number | null;
}

interface RunningExperiment {
  id: string;
  step_id: string;
  /** 'subject' (T02) or 'send_time' (T17). */
  kind: string;
  allocation: { weights?: number[] } | null;
  previous_experiment_id: string | null;
}

interface SenderRow {
  id: string;
  from_name: string;
  from_email: string;
  reply_to: string | null;
  daily_limit: number;
  effective_daily_limit: number;
  send_window_start: number | null;
  send_window_end: number | null;
}

@Injectable()
export class SendService implements BeforeApplicationShutdown {
  private readonly logger = new Logger(SendService.name);

  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    private readonly senders: SendersService,
    private readonly config: ConfigService,
    private readonly usage: UsageService,
    private readonly realtime: RealtimeService,
  ) {}

  private get clickKey() {
    return clickKey(this.config.get<string>('APP_ENCRYPTION_KEY') ?? '');
  }

  private get baseUrl(): string {
    return this.config.get<string>('API_URL', 'http://localhost:4000');
  }

  /** Set when the API is shutting down: the loop stops between leads. */
  private stopping = false;

  /**
   * The clock the send windows are read against (Learning Loop T17). Mutable so
   * a test can walk a fake clock across a weekend or a DST change. Lease and
   * cap queries still use the database clock; only "is it inside the window"
   * and "when is the next opening" use this one.
   */
  clock: () => Date = () => new Date();

  /**
   * Deploys and scale-downs: finish the lead in hand, start no new one. The
   * tick scheduler waits (capped) for the in-flight tick, so no email is left
   * half-recorded and nothing is sent twice by the next instance.
   */
  beforeApplicationShutdown() {
    this.stopping = true;
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
    const touched = new Set<string>();
    for (const row of due.rows) {
      if (this.stopping) break; // shutting down: leave the rest for next tick
      try {
        const outcome = await this.processLead(
          row.org_id,
          row.campaign_lead_id,
        );
        counts[outcome]++;
        if (outcome !== 'deferred' && outcome !== 'skipped')
          touched.add(row.org_id);
      } catch (err) {
        counts.failed++;
        this.logger.error(
          `send failed for lead ${row.campaign_lead_id}`,
          err as Error,
        );
      }
    }
    // one "campaign stats changed" per workspace per tick, not per email
    for (const org of touched) this.realtime.toOrg(org, { type: 'campaigns' });
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

  /**
   * The running experiment of a campaign, with a FOR SHARE lock on its row.
   * Re-reads if the test stopped being the running one while we waited for the
   * lock (a challenger approval closes it and starts the next).
   */
  private async lockRunningExperiment(
    c: PoolClient,
    campaignId: string,
  ): Promise<RunningExperiment | null> {
    for (let attempt = 0; attempt < 3; attempt++) {
      const r = await c.query<RunningExperiment>(
        `SELECT id, step_id, kind, allocation, previous_experiment_id FROM experiments
         WHERE campaign_id = $1 AND status = 'running' LIMIT 1`,
        [campaignId],
      );
      const exp = r.rows[0];
      if (!exp) return null;
      const locked = await c.query(
        `SELECT 1 FROM experiments WHERE id = $1 AND status = 'running' FOR SHARE`,
        [exp.id],
      );
      if ((locked.rowCount ?? 0) > 0) return exp;
    }
    return null;
  }

  /**
   * The company's assignment in any EARLIER test of the chain that led to
   * this one (previous_experiment_id, and its previous, ...), newest first,
   * with the version's subject and its position in that test.
   */
  private async priorAssignment(
    c: PoolClient,
    experimentId: string,
    companyKey: string,
  ): Promise<{
    experiment_id: string;
    variant_id: string;
    variant_index: number;
    subject: string;
  } | null> {
    const r = await c.query<{ experiment_id: string; variant_id: string }>(
      `WITH RECURSIVE chain AS (
         SELECT id, previous_experiment_id FROM experiments WHERE id = $1
         UNION ALL
         SELECT e.id, e.previous_experiment_id
           FROM experiments e JOIN chain ch ON e.id = ch.previous_experiment_id
       )
       SELECT ea.experiment_id, ea.variant_id
         FROM experiment_assignments ea
         JOIN chain ON chain.id = ea.experiment_id
        WHERE ea.experiment_id <> $1 AND ea.company_key = $2
        ORDER BY ea.assigned_at DESC LIMIT 1`,
      [experimentId, companyKey],
    );
    const a = r.rows[0];
    if (!a) return null;
    const vs = await c.query<{ id: string; subject: string }>(
      `SELECT id, subject FROM experiment_variants
        WHERE experiment_id = $1 ORDER BY created_at ASC, id ASC`,
      [a.experiment_id],
    );
    const idx = vs.rows.findIndex((v) => v.id === a.variant_id);
    return {
      experiment_id: a.experiment_id,
      variant_id: a.variant_id,
      variant_index: idx >= 0 ? idx : 0,
      subject: vs.rows[idx >= 0 ? idx : 0]?.subject ?? '',
    };
  }

  /**
   * The company's arm in a send-time test (Learning Loop T17), with that arm's
   * window. The FIRST touch (the test's step) creates the assignment, in the
   * same transaction and before anything is dispatched, with the same hash as
   * a subject test. Any later step only READS it: a company that was already
   * past its first touch when the test started is not in the test, and is
   * never pulled in half-way through its sequence.
   */
  private async sendTimeArm(
    c: PoolClient,
    orgId: string,
    exp: RunningExperiment,
    companyKey: string,
    mayAssign: boolean,
  ): Promise<{ id: string; index: number; window: SendWindow | null } | null> {
    const vs = await c.query<AssignableVariant & { send_window: unknown }>(
      `SELECT id, label, subject, status, is_control, created_at, send_window
         FROM experiment_variants
        WHERE experiment_id = $1
        ORDER BY created_at ASC, id ASC`,
      [exp.id],
    );
    const variants = vs.rows;
    if (mayAssign) {
      const weights = Array.isArray(exp.allocation?.weights)
        ? exp.allocation.weights
        : undefined;
      // paused arms get no NEW companies; a company already assigned keeps its
      // arm even if that arm was paused later (the assignment is the
      // randomisation, same rule as T11 for subjects)
      const candidate = pickExperimentVariant(
        exp.id,
        companyKey,
        variants,
        weights,
      );
      await c.query(
        `INSERT INTO experiment_assignments
           (org_id, experiment_id, company_key, variant_id, hash)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (experiment_id, company_key) DO NOTHING`,
        [orgId, exp.id, companyKey, candidate.variant.id, candidate.hash],
      );
    }
    const a = await c.query<{ variant_id: string }>(
      `SELECT variant_id FROM experiment_assignments
        WHERE experiment_id = $1 AND company_key = $2`,
      [exp.id, companyKey],
    );
    const idx = variants.findIndex((v) => v.id === a.rows[0]?.variant_id);
    if (idx < 0) return null;
    return {
      id: variants[idx].id,
      index: idx,
      window: parseSendWindow(variants[idx].send_window),
    };
  }

  /**
   * The recipient's timezone: the one frozen in the enrollment snapshot (so a
   * later edit of the lead's city cannot move a company between arms' clocks),
   * else the lead's own. Anything that is not a real IANA zone ("unknown") is
   * skipped; null means "use the workspace clock".
   */
  private recipientTimezone(
    snapshot: Record<string, unknown> | null,
    leadTz: string | null,
  ): string | null {
    const fromSnapshot =
      typeof snapshot?.timezone === 'string' ? snapshot.timezone : null;
    for (const tz of [fromSnapshot, leadTz]) {
      if (tz && isValidTimeZone(tz)) return tz;
    }
    return null;
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
        snapshot: Record<string, unknown> | null;
      }>(
        // Claim with a lease: atomically push next_send_at out, but only if
        // the lead is still due. Overlapping ticks (two instances, a slow
        // scheduled tick + a manual "run due sends") serialise on this row;
        // the loser sees it's no longer due and skips — no double sends.
        // Phase 3 sets the real next_send_at; if we crash before that, the
        // lease simply expires and the lead is retried.
        `UPDATE campaign_leads
         SET next_send_at = now() + interval '10 minutes'
         WHERE id = $1 AND next_send_at IS NOT NULL AND next_send_at <= now()
         RETURNING id, campaign_id, lead_id, current_step, status, unsub_token, snapshot`,
        [leadStateId],
      );
      if (clRes.rowCount === 0) return { outcome: 'skipped' as Outcome };
      const cl = clRes.rows[0];
      if (cl.status !== 'active') return { outcome: 'skipped' as Outcome };

      const campRes = await c.query<{
        sender_ids: string[];
        status: string;
        send_window: unknown;
      }>(
        `SELECT sender_ids, status, send_window FROM campaigns WHERE id = $1`,
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
      // T17: null = no window = send whenever due, exactly as before.
      const campaignWindow = parseSendWindow(campRes.rows[0].send_window);

      const stepsRes = await c.query<StepRow>(
        `SELECT id, template_id, delay_hours, condition, subject_variants, winner_index
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
        company_key: string | null;
        timezone: string | null;
      }>(
        `SELECT email, first_name, last_name, company, title, phone, company_key, timezone
         FROM leads WHERE id = $1`,
        [cl.lead_id],
      );
      if (leadRes.rowCount === 0) {
        await this.stop(c, cl.id, 'lead_deleted');
        return { outcome: 'skipped' as Outcome };
      }
      const lead = leadRes.rows[0];

      // Check whether this step has a running experiment (Learning Loop T02).
      // The running test is read, then locked FOR SHARE (T11): an approval that
      // pauses a version or starts a challenger holds FOR UPDATE on the same
      // row, so a dispatch never straddles it (it waits, then sees the new
      // state: the paused version, or the new test).
      const runningExp = await this.lockRunningExperiment(c, cl.campaign_id);
      const isExperimentStep =
        runningExp !== null && runningExp.step_id === step.id;

      // Experiment eligibility: lead must have a company_key. If ineligible,
      // do not assign and do not send.
      if (isExperimentStep && !lead.company_key) {
        await this.stop(c, cl.id, 'experiment_ineligible');
        return { outcome: 'skipped' as Outcome };
      }

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

      // Send window (Learning Loop T17). Which window applies:
      //  - a running SEND-TIME test: the window of the company's arm, for every
      //    step of its sequence (the arm is the schedule). The first touch
      //    creates the assignment here, before anything is dispatched, so a
      //    deferred company is already assigned and stays on its arm;
      //  - otherwise the campaign's own window, if it has one;
      //  - otherwise none: send now, as before.
      // Outside the window the send is not dropped: next_send_at moves to the
      // next opening in the RECIPIENT's timezone (workspace timezone when we
      // do not know theirs), spread across that slot so a night's backlog does
      // not fire at 09:00:00. Sender caps and warm-up still apply after this.
      let sendTimeArm: { id: string; index: number } | null = null;
      let activeWindow: SendWindow | null = campaignWindow;
      if (runningExp?.kind === 'send_time' && lead.company_key) {
        const arm = await this.sendTimeArm(
          c,
          orgId,
          runningExp,
          lead.company_key,
          isExperimentStep,
        );
        if (arm) {
          sendTimeArm = { id: arm.id, index: arm.index };
          activeWindow = arm.window ?? campaignWindow;
        }
      }
      if (activeWindow) {
        const orgTz = await c.query<{ timezone: string | null }>(
          `SELECT timezone FROM orgs WHERE id = $1`,
          [orgId],
        );
        const when = scheduleInWindow({
          window: activeWindow,
          now: this.clock(),
          recipientTz: this.recipientTimezone(cl.snapshot, lead.timezone),
          workspaceTz: orgTz.rows[0]?.timezone,
          // stable per lead + step: a retry lands at the same minute
          seed: `${cl.id}:${cl.current_step}`,
        });
        if (!when.inside && when.nextSendAt) {
          await c.query(
            `UPDATE campaign_leads SET next_send_at = $2, updated_at = now()
             WHERE id = $1`,
            [cl.id, when.nextSendAt],
          );
          return { outcome: 'deferred' as Outcome };
        }
      }

      // Plan email caps (per day / per month): defer, don't drop — the lead
      // stays due and goes out once the window resets.
      if (await this.usage.emailCapReached(c, orgId)) {
        return { outcome: 'deferred' as Outcome };
      }

      // Choose a sender: eligible = campaign's sender_ids (or all org senders)
      // that are verified, within send window, with remaining daily capacity.
      // Pick the most-free. Unverified/revoked senders never send; with none
      // usable the lead waits (deferred) instead of being burned.
      const sendersRes = senderIds.length
        ? await c.query<SenderRow>(
            `SELECT id, from_name, from_email, reply_to, daily_limit, ${effectiveLimitSql()} AS effective_daily_limit, send_window_start, send_window_end
             FROM sender_accounts WHERE id = ANY($1::uuid[]) AND status = 'verified'`,
            [senderIds],
          )
        : await c.query<SenderRow>(
            `SELECT id, from_name, from_email, reply_to, daily_limit, ${effectiveLimitSql()} AS effective_daily_limit, send_window_start, send_window_end
             FROM sender_accounts WHERE status = 'verified' ORDER BY created_at`,
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
        // warm-up ramp caps a young mailbox below its configured limit
        const remaining = s.effective_daily_limit - cnt.rows[0].n;
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
      let experimentId: string | null = null;
      let variantId: string | null = null;

      if (
        isExperimentStep &&
        runningExp &&
        lead.company_key &&
        runningExp.kind !== 'send_time'
      ) {
        // New path (Learning Loop T02): company-level assignment persisted
        // before dispatch in the same transaction. (A send-time test, T17,
        // already assigned above and keeps the step's own subject.)
        const evRes = await c.query<AssignableVariant>(
          `SELECT id, label, subject, status, is_control, created_at
           FROM experiment_variants
           WHERE experiment_id = $1
           ORDER BY created_at ASC, id ASC`,
          [runningExp.id],
        );
        const expVariants = evRes.rows;

        // T11: a company already assigned in an EARLIER test of this step (the
        // one a challenger replaced) is not eligible for the new test. It keeps
        // its old version and is credited to the old test, like a colleague at
        // the same company would be.
        const prior = runningExp.previous_experiment_id
          ? await this.priorAssignment(c, runningExp.id, lead.company_key)
          : null;
        const hasCurrent = prior
          ? ((
              await c.query(
                `SELECT 1 FROM experiment_assignments
                 WHERE experiment_id = $1 AND company_key = $2`,
                [runningExp.id, lead.company_key],
              )
            ).rowCount ?? 0) > 0
          : false;

        if (prior && !hasCurrent) {
          experimentId = prior.experiment_id;
          variantId = prior.variant_id;
          variantIndex = prior.variant_index;
          subject = prior.subject;
        } else {
          const weights = Array.isArray(runningExp.allocation?.weights)
            ? runningExp.allocation.weights
            : undefined;
          // New companies hash over the ACTIVE versions only (a paused version
          // gets no new first touches). The assignment, once stored, is the
          // randomisation: a company already assigned to a version that was
          // paused later, with nothing sent yet, KEEPS it. Re-assigning it would
          // bias the test. Existing assignments, in-flight sequences and history
          // are never moved by a pause (T11).
          const candidate = pickExperimentVariant(
            runningExp.id,
            lead.company_key,
            expVariants,
            weights,
          );
          await c.query(
            `INSERT INTO experiment_assignments
             (org_id, experiment_id, company_key, variant_id, hash)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (experiment_id, company_key) DO NOTHING`,
            [
              orgId,
              runningExp.id,
              lead.company_key,
              candidate.variant.id,
              candidate.hash,
            ],
          );
          const assignedRes = await c.query<{ variant_id: string }>(
            `SELECT variant_id FROM experiment_assignments
           WHERE experiment_id = $1 AND company_key = $2`,
            [runningExp.id, lead.company_key],
          );
          const assignedVariantId =
            assignedRes.rows[0]?.variant_id ?? candidate.variant.id;
          const assignedIdx = expVariants.findIndex(
            (v) => v.id === assignedVariantId,
          );
          const assignedVar =
            assignedIdx >= 0 ? expVariants[assignedIdx] : candidate.variant;
          experimentId = runningExp.id;
          variantId = assignedVar.id;
          variantIndex =
            assignedIdx >= 0 ? assignedIdx : candidate.variantIndex;
          subject = assignedVar.subject;
        }
      } else {
        // Legacy path (untouched when no running experiment is on this step).
        const variants = step.subject_variants ?? [];
        const winner = step.winner_index;
        if (winner !== null && typeof variants[winner] === 'string') {
          // approved A/B winner: every remaining lead gets it, credited to its
          // own version (not renumbered)
          variantIndex = winner;
          subject = variants[winner];
        } else if (variants.length > 0) {
          const sentForStep = await c.query<{ n: number }>(
            `SELECT count(*)::int AS n FROM sent_emails WHERE step_id = $1`,
            [step.id],
          );
          variantIndex = sentForStep.rows[0].n % variants.length;
          subject = variants[variantIndex];
        }

        // Follow-up steps (step 2+): copy experiment_id / variant_id from the
        // company's assignment if one exists for this campaign.
        if (lead.company_key) {
          const followUpAssign = await c.query<{
            experiment_id: string;
            variant_id: string;
          }>(
            `SELECT ea.experiment_id, ea.variant_id
             FROM experiment_assignments ea
             JOIN experiments e ON e.id = ea.experiment_id
             WHERE e.campaign_id = $1 AND ea.company_key = $2
             ORDER BY ea.assigned_at DESC LIMIT 1`,
            [cl.campaign_id, lead.company_key],
          );
          if (followUpAssign.rows[0]) {
            experimentId = followUpAssign.rows[0].experiment_id;
            variantId = followUpAssign.rows[0].variant_id;
          }
        }
      }

      // T17 send-time test: the subject is the step's own (identical in both
      // arms; the rotation above cannot run, a test never starts on a step with
      // an un-won rotation). The email is credited to the company's arm.
      if (sendTimeArm && runningExp) {
        experimentId = runningExp.id;
        variantId = sendTimeArm.id;
        variantIndex = sendTimeArm.index;
      }

      // CAN-SPAM footer identity: workspace name + postal address.
      const org = await c.query<{
        name: string;
        postal_address: string | null;
        website: string | null;
      }>(`SELECT name, postal_address, website FROM orgs WHERE id = $1`, [
        orgId,
      ]);
      const senderEmail = chosen.reply_to || chosen.from_email;
      const vars = {
        ...varsFromLead(lead),
        sender_name: chosen.from_name,
        sender_email: senderEmail,
        sender_company: org.rows[0]?.name ?? null,
        // no website in Settings: website buttons become a reply link
        // instead of a dead one
        sender_website:
          websiteUrl(org.rows[0]?.website) ?? `mailto:${senderEmail}`,
      };

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
          experimentId,
          variantId,
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
      signLink: (id, url) => signClick(this.clickKey, id, url),
    });

    let messageId: string | null = null;
    let provider: string | null = null;
    let error: string | null = null;
    let senderAuthBroke = false;
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
      // revoked/expired Google access: the sender is flagged unverified by
      // SendersService; this lead retries later via another (or reconnected)
      // sender instead of moving past this step
      senderAuthBroke = err instanceof GmailAuthError;
    }

    // Phase 3: record + advance.
    await withOrgContext(this.pool, orgId, async (c) => {
      const se = await c.query<{ id: string }>(
        `INSERT INTO sent_emails
           (org_id, campaign_id, campaign_lead_id, lead_id, step_id, sender_id,
            to_email, subject, message_id, provider, status, variant_index,
            experiment_id, variant_id, tracking_id, error)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
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
          p.experimentId,
          p.variantId,
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
      if (senderAuthBroke || (error && p.experimentId)) {
        await c.query(
          `UPDATE campaign_leads SET next_send_at = now() + interval '15 minutes',
             updated_at = now() WHERE id = $1`,
          [p.cl.id],
        );
      } else {
        await this.advance(c, p.cl.id, p.nextIndex, p.steps);
      }
    });

    if (senderAuthBroke) return 'deferred';
    return error ? 'failed' : 'sent';
  }
}
