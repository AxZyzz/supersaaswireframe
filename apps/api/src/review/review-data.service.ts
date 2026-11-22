import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { Pool } from 'pg';
import { PG_POOL } from '../db/db.module';
import { withOrgContext } from '../db/tenant-context';
import { OutcomesService } from '../outcomes/outcomes.service';
import {
  describeSendWindow,
  parseSendWindow,
  type SendWindow,
} from '../sending/send-window';
import { POLICY_VERSION, type Guardrails, type ReviewInput } from './policy';
import {
  aggregate,
  type CompanyRow,
  type Slice,
  type VariantInfo,
} from './review-aggregate';

/** Outcome coverage the review needs before it will call a winner (Aman's default). */
export const COVERAGE_GATE = 0.9;

/** One arm of the test as the Review shows it (T17: the window for send-time tests). */
export interface ExperimentArm {
  variantId: string;
  label: string;
  /** null for subject tests. */
  sendWindow: SendWindow | null;
  /** "Tue-Thu 09:00-11:00 (recipient time)", or null for subject tests. */
  windowText: string | null;
}

export interface ExperimentMeta {
  id: string;
  campaignId: string;
  campaignName: string;
  stepId: string;
  /** 'subject' (T02) or 'send_time' (T17): what the two arms differ by. */
  kind: 'subject' | 'send_time';
  /** Both arms in test order, with their send windows when kind is send_time. */
  arms: ExperimentArm[];
  status: string;
  offerName: string | null;
  primaryMetric: string;
  secondaryMetric: string;
  responseWindowDays: number;
  decisionDate: Date | null;
  startedAt: Date | null;
  baselineRate: number;
  minLiftPp: number;
  targetNPerArm: number | null;
  guardrails: Guardrails;
}

export interface ReviewSource {
  meta: ExperimentMeta;
  variants: VariantInfo[];
  input: ReviewInput;
  slices: Slice[];
}

interface MetaRow {
  id: string;
  campaign_id: string;
  campaign_name: string;
  step_id: string;
  kind: string;
  status: string;
  offer_name: string | null;
  primary_metric: string;
  secondary_metric: string;
  response_window_days: number;
  decision_date: Date | null;
  started_at: Date | null;
  baseline_rate: number;
  min_lift_pp: number;
  target_n_per_arm: number | null;
  guardrails: {
    bounce?: number;
    unsubscribe?: number;
    unsub?: number;
    complaint?: number;
  } | null;
}

export const META_SQL = `SELECT e.id, e.campaign_id, cp.name AS campaign_name, e.step_id, e.kind, e.status,
        o.name AS offer_name, e.primary_metric, e.secondary_metric,
        e.response_window_days, e.decision_date, e.started_at,
        e.baseline_rate, e.min_lift_pp, e.target_n_per_arm, e.guardrails
   FROM experiments e
   JOIN campaigns cp ON cp.id = e.campaign_id
   LEFT JOIN offers o ON o.id = e.offer_ref
  WHERE e.id = $1`;

/** The arms of a test from its variant rows, windows described in plain words. */
export function toArms(
  rows: { id: string; label: string; send_window?: unknown }[],
): ExperimentArm[] {
  return rows.map((r) => {
    const w = parseSendWindow(r.send_window);
    return {
      variantId: r.id,
      label: r.label,
      sendWindow: w,
      windowText: w ? describeSendWindow(w) : null,
    };
  });
}

export function toMeta(x: MetaRow, arms: ExperimentArm[] = []): ExperimentMeta {
  const g = x.guardrails ?? {};
  return {
    id: x.id,
    campaignId: x.campaign_id,
    campaignName: x.campaign_name,
    stepId: x.step_id,
    kind: x.kind === 'send_time' ? 'send_time' : 'subject',
    arms,
    status: x.status,
    offerName: x.offer_name,
    primaryMetric: x.primary_metric,
    secondaryMetric: x.secondary_metric,
    responseWindowDays: x.response_window_days,
    decisionDate: x.decision_date,
    startedAt: x.started_at,
    baselineRate: Number(x.baseline_rate),
    minLiftPp: Number(x.min_lift_pp),
    targetNPerArm: x.target_n_per_arm,
    guardrails: {
      bounce: g.bounce ?? 0.05,
      unsub: g.unsub ?? g.unsubscribe ?? 0.02,
      complaint: g.complaint ?? 0.003,
    },
  };
}

interface CompanySqlRow {
  variant_id: string;
  company_key: string;
  first_sent: Date | null;
  opened: boolean;
  bounced: boolean;
  replied: boolean;
  qualified_verified: boolean;
  qualified_provisional: boolean;
  booked: boolean;
  unsubscribed: boolean;
  complaint: boolean;
  city: string | null;
  industry: string | null;
  trigger: string | null;
}

/**
 * Per-company facts for one experiment, straight from Postgres. The unit is the
 * company (company_key): two contacts at one company are ONE row. Counting
 * rules, all per company:
 *  - sent: at least one step-1 email sent; delivered = sent and not bounced;
 *  - opened: at least one REAL open (scanner hits are stored as bot_open);
 *  - qualified / booked: the CURRENT verified outcome, inside the response
 *    window that starts at the company's first send (late ones are kept in
 *    outcome_events but not counted here);
 *  - provisional qualified: AI label still waiting for a person.
 * All queries run inside one tenant (RLS) context.
 */
@Injectable()
export class ReviewDataService {
  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    private readonly outcomes: OutcomesService,
  ) {}

  /** The experiment's plan (offer, window, decision date), for the goal strip. */
  async meta(orgId: string, experimentId: string): Promise<ExperimentMeta> {
    return withOrgContext(this.pool, orgId, async (c) => {
      const e = await c.query<MetaRow>(META_SQL, [experimentId]);
      if (!e.rows[0]) throw new NotFoundException('Experiment not found');
      const v = await c.query<{
        id: string;
        label: string;
        send_window: unknown;
      }>(
        `SELECT id, label, send_window FROM experiment_variants
          WHERE experiment_id = $1 ORDER BY created_at, id`,
        [experimentId],
      );
      return toMeta(e.rows[0], toArms(v.rows));
    });
  }

  /** Everything the policy needs, as of `now`. */
  async load(
    orgId: string,
    experimentId: string,
    now: Date = new Date(),
  ): Promise<ReviewSource> {
    const { meta, variants, rows, flags } = await withOrgContext(
      this.pool,
      orgId,
      async (c) => {
        const e = await c.query<MetaRow>(META_SQL, [experimentId]);
        const x = e.rows[0];
        if (!x) throw new NotFoundException('Experiment not found');

        const v = await c.query<{
          id: string;
          label: string;
          is_control: boolean;
          send_window: unknown;
        }>(
          `SELECT id, label, is_control, send_window FROM experiment_variants
            WHERE experiment_id = $1 ORDER BY created_at, id`,
          [experimentId],
        );

        const co = await c.query<CompanySqlRow>(
          `WITH exp AS (
             SELECT id, step_id, campaign_id, response_window_days
               FROM experiments WHERE id = $1
           ), sr AS (
             SELECT se.id AS sent_email_id, se.sent_at,
                    COALESCE(cl.snapshot->>'company_key', l.company_key) AS company_key
               FROM sent_emails se
               JOIN exp ON exp.id = se.experiment_id AND se.step_id = exp.step_id
               LEFT JOIN campaign_leads cl ON cl.id = se.campaign_lead_id
               LEFT JOIN leads l ON l.id = se.lead_id
              WHERE se.status = 'sent'
           ), oc AS (
             SELECT company_key, type, verification, occurred_at
               FROM v_outcomes_current WHERE experiment_id = $1
           ), snap AS (
             SELECT DISTINCT ON (ck) ck AS company_key, snapshot FROM (
               SELECT COALESCE(cl.snapshot->>'company_key', l.company_key) AS ck,
                      cl.snapshot, cl.created_at
                 FROM campaign_leads cl
                 JOIN leads l ON l.id = cl.lead_id
                 JOIN exp ON exp.campaign_id = cl.campaign_id
             ) x ORDER BY ck, created_at
           )
           SELECT a.variant_id, a.company_key, fs.first_sent,
             EXISTS (SELECT 1 FROM email_events ev
                       JOIN sr ON sr.sent_email_id = ev.sent_email_id
                      WHERE sr.company_key = a.company_key AND ev.type = 'open') AS opened,
             EXISTS (SELECT 1 FROM oc WHERE oc.company_key = a.company_key
                      AND oc.type = 'bounce') AS bounced,
             EXISTS (SELECT 1 FROM oc WHERE oc.company_key = a.company_key
                      AND oc.type = 'reply') AS replied,
             EXISTS (SELECT 1 FROM oc WHERE oc.company_key = a.company_key
                      AND oc.type = 'qualified_reply' AND oc.verification = 'verified'
                      AND oc.occurred_at <= fs.first_sent
                          + make_interval(days => exp.response_window_days)) AS qualified_verified,
             EXISTS (SELECT 1 FROM oc WHERE oc.company_key = a.company_key
                      AND oc.type = 'qualified_reply' AND oc.verification = 'provisional'
                      AND oc.occurred_at <= fs.first_sent
                          + make_interval(days => exp.response_window_days)) AS qualified_provisional,
             EXISTS (SELECT 1 FROM oc WHERE oc.company_key = a.company_key
                      AND oc.type = 'booked_call' AND oc.verification = 'verified'
                      AND oc.occurred_at <= fs.first_sent
                          + make_interval(days => exp.response_window_days)) AS booked,
             EXISTS (SELECT 1 FROM oc WHERE oc.company_key = a.company_key
                      AND oc.type = 'unsubscribe') AS unsubscribed,
             EXISTS (SELECT 1 FROM oc WHERE oc.company_key = a.company_key
                      AND oc.type = 'complaint') AS complaint,
             NULLIF(s.snapshot->>'city', '') AS city,
             NULLIF(s.snapshot->>'industry', '') AS industry,
             NULLIF(s.snapshot->>'primary_trigger', '') AS trigger
             FROM experiment_assignments a
            CROSS JOIN exp
             LEFT JOIN LATERAL (
               SELECT min(sr.sent_at) AS first_sent FROM sr
                WHERE sr.company_key = a.company_key
             ) fs ON true
             LEFT JOIN snap s ON s.company_key = a.company_key
            WHERE a.experiment_id = $1`,
          [experimentId],
        );

        // Replies we could not tie to ONE test: shown, never guessed. Scoped to
        // people enrolled in this experiment's campaign.
        const fl = await c.query<{ unattributed: number; ambiguous: number }>(
          `SELECT count(*) FILTER (WHERE o.type = 'reply')::int AS unattributed,
                  count(*) FILTER (WHERE o.type = 'reply'
                    AND o.reason LIKE 'Lead is in several campaigns%')::int AS ambiguous
             FROM v_outcomes_current o
            WHERE o.campaign_lead_id IS NULL
              AND o.lead_id IN (SELECT lead_id FROM campaign_leads WHERE campaign_id = $1)`,
          [x.campaign_id],
        );

        return {
          meta: toMeta(x, toArms(v.rows)),
          variants: v.rows.map((r): VariantInfo => ({
            id: r.id,
            label: r.label,
            isControl: r.is_control,
          })),
          rows: co.rows.map((r): CompanyRow => ({
            variantId: r.variant_id,
            companyKey: r.company_key,
            firstSentAt: r.first_sent,
            opened: r.opened,
            bounced: r.bounced,
            replied: r.replied,
            qualifiedVerified: r.qualified_verified,
            qualifiedProvisional: r.qualified_provisional,
            booked: r.booked,
            unsubscribed: r.unsubscribed,
            complaint: r.complaint,
            city: r.city,
            industry: r.industry,
            trigger: r.trigger,
          })),
          flags: {
            unattributedReplies: fl.rows[0]?.unattributed ?? 0,
            ambiguousAttribution: fl.rows[0]?.ambiguous ?? 0,
          },
        };
      },
    );

    const agg = aggregate(rows, variants, now, meta.responseWindowDays);
    const cov = await this.outcomes.coverage(orgId, experimentId);

    const input: ReviewInput = {
      experimentId: meta.id,
      policyVersion: POLICY_VERSION,
      now,
      decisionDate: meta.decisionDate,
      earliestFullRead: agg.earliestFullRead,
      baselineRate: meta.baselineRate,
      minLiftPp: meta.minLiftPp,
      targetNPerArm: meta.targetNPerArm,
      guardrails: meta.guardrails,
      coverageGate: COVERAGE_GATE,
      outcomeCoverage: cov.coverage,
      arms: agg.arms,
      flags: { ...flags, variantEditedWhileRunning: false },
      simulated: false,
    };
    return { meta, variants, input, slices: agg.slices };
  }
}
