import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Pool, PoolClient } from 'pg';
import { PG_POOL } from '../db/db.module';
import { withOrgContext } from '../db/tenant-context';
import {
  keys,
  outcomeCoverage,
  type OutcomeSource,
  type OutcomeType,
  reasonRequired,
  VERIFIABLE_TYPES,
  type Verification,
} from './outcome-logic';

export interface OutcomeInput {
  type: OutcomeType;
  source: OutcomeSource;
  verification: Verification;
  idempotencyKey: string;
  occurredAt?: Date;
  leadId?: string | null;
  /** Enrollment, when known (conversation / thread match). */
  campaignLeadId?: string | null;
  sentEmailId?: string | null;
  conversationId?: string | null;
  createdBy?: string | null;
  verifiedBy?: string | null;
  reason?: string | null;
  /** Force "unattributed" (ambiguous thread): keep the lead, drop the enrollment. */
  unattributed?: boolean;
}

export interface OutcomeRow {
  id: string;
  type: OutcomeType;
  source: OutcomeSource;
  verification: Verification;
  campaign_lead_id: string | null;
  lead_id: string | null;
  company_key: string | null;
  experiment_id: string | null;
  variant_id: string | null;
  conversation_id: string | null;
  sent_email_id: string | null;
  occurred_at: Date;
  verified_by: string | null;
  verified_at: Date | null;
  reason: string | null;
  supersedes_id: string | null;
}

/** A row from a list/history query (shape varies; the web client types it). */
type Row = Record<string, unknown>;

const COLS = `id, type, source, verification, campaign_lead_id, lead_id, company_key,
  experiment_id, variant_id, conversation_id, sent_email_id, occurred_at,
  verified_by, verified_at, reason, supersedes_id`;

interface Attribution {
  campaignLeadId: string | null;
  leadId: string | null;
  companyKey: string | null;
  experimentId: string | null;
  variantId: string | null;
  sentEmailId: string | null;
}

/**
 * Outcome events: idempotent, attributed, human-verifiable. Producers (inbox,
 * Gmail sync, bounce, unsubscribe, converted) call `record()` inside their own
 * transaction; people use verify() / manual(). Code records and counts; AI
 * only ever proposes a *provisional* label.
 */
@Injectable()
export class OutcomesService {
  private readonly logger = new Logger(OutcomesService.name);

  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  // ── attribution ──────────────────────────────────────────────────────────

  /**
   * Which enrollment, company and experiment variant does this belong to?
   * Never guesses: no match leaves experiment / variant null (unattributed).
   */
  async attribute(
    c: PoolClient,
    a: {
      leadId?: string | null;
      campaignLeadId?: string | null;
      sentEmailId?: string | null;
    },
  ): Promise<Attribution> {
    let campaignLeadId = a.campaignLeadId ?? null;
    let leadId = a.leadId ?? null;
    let experimentId: string | null = null;
    let variantId: string | null = null;
    const sentEmailId = a.sentEmailId ?? null;

    if (sentEmailId) {
      const se = await c.query<{
        campaign_lead_id: string | null;
        lead_id: string | null;
        experiment_id: string | null;
        variant_id: string | null;
      }>(
        `SELECT campaign_lead_id, lead_id, experiment_id, variant_id
           FROM sent_emails WHERE id = $1`,
        [sentEmailId],
      );
      const s = se.rows[0];
      if (s) {
        campaignLeadId = campaignLeadId ?? s.campaign_lead_id;
        leadId = leadId ?? s.lead_id;
        experimentId = s.experiment_id;
        variantId = s.variant_id;
      }
    }

    let companyKey: string | null = null;
    let campaignId: string | null = null;
    if (campaignLeadId) {
      const cl = await c.query<{
        lead_id: string;
        campaign_id: string;
        snapshot_key: string | null;
        lead_key: string | null;
      }>(
        `SELECT cl.lead_id, cl.campaign_id,
                cl.snapshot->>'company_key' AS snapshot_key,
                l.company_key AS lead_key
           FROM campaign_leads cl JOIN leads l ON l.id = cl.lead_id
          WHERE cl.id = $1`,
        [campaignLeadId],
      );
      if (cl.rows[0]) {
        leadId = leadId ?? cl.rows[0].lead_id;
        campaignId = cl.rows[0].campaign_id;
        // the snapshot is what the lead looked like at enrollment
        companyKey = cl.rows[0].snapshot_key ?? cl.rows[0].lead_key;
      } else {
        campaignLeadId = null;
      }
    }
    if (!companyKey && leadId) {
      const l = await c.query<{ company_key: string | null }>(
        `SELECT company_key FROM leads WHERE id = $1`,
        [leadId],
      );
      companyKey = l.rows[0]?.company_key ?? null;
    }
    // The company's assignment, when the email itself didn't carry one.
    if (!experimentId && companyKey && campaignId) {
      const as = await c.query<{ experiment_id: string; variant_id: string }>(
        `SELECT a.experiment_id, a.variant_id
           FROM experiment_assignments a
           JOIN experiments e ON e.id = a.experiment_id
          WHERE e.campaign_id = $1 AND a.company_key = $2
          ORDER BY e.created_at DESC LIMIT 1`,
        [campaignId, companyKey],
      );
      if (as.rows[0]) {
        experimentId = as.rows[0].experiment_id;
        variantId = as.rows[0].variant_id;
      }
    }
    return {
      campaignLeadId,
      leadId,
      companyKey,
      experimentId,
      variantId,
      sentEmailId,
    };
  }

  // ── producing events ─────────────────────────────────────────────────────

  /**
   * Insert one event inside the caller's transaction. Idempotent on
   * (org_id, idempotency_key): a duplicate webhook / sync returns
   * `created: false`. Best effort: a failure here is logged and rolled back to
   * a savepoint so it never breaks the reply / bounce / unsubscribe itself.
   */
  async record(
    c: PoolClient,
    orgId: string,
    e: OutcomeInput,
  ): Promise<{ id: string; created: boolean } | null> {
    await c.query('SAVEPOINT outcome_sp');
    try {
      const at = e.unattributed
        ? await this.attribute(c, { leadId: e.leadId })
        : await this.attribute(c, {
            leadId: e.leadId,
            campaignLeadId: e.campaignLeadId,
            sentEmailId: e.sentEmailId,
          });
      const unattributed = !!e.unattributed;
      const ins = await c.query<{ id: string }>(
        `INSERT INTO outcome_events
           (org_id, campaign_lead_id, lead_id, company_key, experiment_id,
            variant_id, conversation_id, sent_email_id, type, source,
            verification, occurred_at, created_by, verified_by, verified_at,
            reason, idempotency_key)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,COALESCE($12, now()),$13,$14,
                 CASE WHEN $14::uuid IS NULL THEN NULL ELSE now() END,$15,$16)
         ON CONFLICT (org_id, idempotency_key) DO NOTHING
         RETURNING id`,
        [
          orgId,
          unattributed ? null : at.campaignLeadId,
          at.leadId,
          at.companyKey,
          unattributed ? null : at.experimentId,
          unattributed ? null : at.variantId,
          e.conversationId ?? null,
          unattributed ? null : at.sentEmailId,
          e.type,
          e.source,
          e.verification,
          e.occurredAt ?? null,
          e.createdBy ?? null,
          e.verifiedBy ?? null,
          e.reason ?? null,
          e.idempotencyKey,
        ],
      );
      await c.query('RELEASE SAVEPOINT outcome_sp');
      if (ins.rows[0]) return { id: ins.rows[0].id, created: true };
      const existing = await c.query<{ id: string }>(
        `SELECT id FROM outcome_events WHERE idempotency_key = $1`,
        [e.idempotencyKey],
      );
      return existing.rows[0]
        ? { id: existing.rows[0].id, created: false }
        : null;
    } catch (err) {
      await c.query('ROLLBACK TO SAVEPOINT outcome_sp');
      this.logger.warn(
        `outcome ${e.type} not recorded (${e.idempotencyKey}): ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      return null;
    }
  }

  /**
   * "Booked a call" toggled on a conversation. Turning it on records a
   * booked_call (verified when a manager or admin did it, otherwise it waits
   * as provisional for one). Turning it off inserts a superseding rejected row.
   */
  async recordBooked(
    c: PoolClient,
    orgId: string,
    conv: {
      id: string;
      lead_id: string;
      campaign_lead_id: string | null;
    },
    on: boolean,
    actor: { userId?: string; role?: string },
  ): Promise<void> {
    if (on) {
      const trusted = actor.role === 'admin' || actor.role === 'manager';
      await this.record(c, orgId, {
        type: 'booked_call',
        source: 'manual',
        verification: trusted ? 'verified' : 'provisional',
        idempotencyKey: `booked:${conv.id}:${Date.now()}`,
        leadId: conv.lead_id,
        campaignLeadId: conv.campaign_lead_id,
        conversationId: conv.id,
        createdBy: actor.userId ?? null,
        verifiedBy: trusted ? (actor.userId ?? null) : null,
      });
      return;
    }
    const head = await c.query<OutcomeRow>(
      `SELECT ${COLS} FROM v_outcomes_current
        WHERE conversation_id = $1 AND type = 'booked_call'
          AND verification <> 'rejected'
        ORDER BY occurred_at DESC LIMIT 1`,
      [conv.id],
    );
    if (head.rows[0]) {
      await this.supersede(c, orgId, head.rows[0], {
        verification: 'rejected',
        reason: 'Un-marked as converted',
        userId: actor.userId ?? null,
        key: `unbooked:${head.rows[0].id}`,
      });
    }
  }

  /** Insert the superseding row (the old row is never touched). */
  private async supersede(
    c: PoolClient,
    orgId: string,
    prev: OutcomeRow,
    s: {
      verification: Verification;
      reason: string | null;
      userId: string | null;
      key: string;
    },
  ): Promise<OutcomeRow> {
    const ins = await c.query<OutcomeRow>(
      `INSERT INTO outcome_events
         (org_id, campaign_lead_id, lead_id, company_key, experiment_id,
          variant_id, conversation_id, sent_email_id, type, source,
          verification, occurred_at, created_by, verified_by, verified_at,
          reason, supersedes_id, idempotency_key)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'manual',$10,$11,$12,$12,now(),$13,$14,$15)
       ON CONFLICT (org_id, idempotency_key) DO NOTHING
       RETURNING ${COLS}`,
      [
        orgId,
        prev.campaign_lead_id,
        prev.lead_id,
        prev.company_key,
        prev.experiment_id,
        prev.variant_id,
        prev.conversation_id,
        prev.sent_email_id,
        prev.type,
        s.verification,
        prev.occurred_at,
        s.userId,
        s.reason,
        prev.id,
        s.key,
      ],
    );
    if (ins.rows[0]) return ins.rows[0];
    const again = await c.query<OutcomeRow>(
      `SELECT ${COLS} FROM outcome_events WHERE idempotency_key = $1`,
      [s.key],
    );
    return again.rows[0];
  }

  // ── people ───────────────────────────────────────────────────────────────

  /** Confirm or reject an outcome (agent, manager, admin). Inserts a new row. */
  async verify(
    orgId: string,
    userId: string,
    id: string,
    decision: 'verified' | 'rejected',
    reason?: string,
  ): Promise<OutcomeRow> {
    return withOrgContext(this.pool, orgId, async (c) => {
      // RLS: another workspace's id is simply not found
      const found = await c.query<OutcomeRow>(
        `SELECT ${COLS} FROM outcome_events WHERE id = $1`,
        [id],
      );
      const row = found.rows[0];
      if (!row) throw new NotFoundException('Outcome not found');
      if (!VERIFIABLE_TYPES.includes(row.type)) {
        throw new BadRequestException(
          `A ${row.type.replace('_', ' ')} is a fact, not something to confirm`,
        );
      }
      const newer = await c.query<{ id: string }>(
        `SELECT id FROM outcome_events WHERE supersedes_id = $1 LIMIT 1`,
        [id],
      );
      if (newer.rows[0]) {
        // idempotent retry of the same decision returns the result
        const done = await c.query<OutcomeRow>(
          `SELECT ${COLS} FROM outcome_events WHERE idempotency_key = $1`,
          [keys.verify(id)],
        );
        if (done.rows[0] && done.rows[0].verification === decision) {
          return done.rows[0];
        }
        throw new ConflictException(
          'This outcome was already updated. Refresh and try again.',
        );
      }
      const why = reason?.trim() || null;
      if (reasonRequired(row.verification) && !why) {
        throw new BadRequestException(
          'Say why you are changing a decision that was already made',
        );
      }
      const out = await this.supersede(c, orgId, row, {
        verification: decision,
        reason: why,
        userId,
        key: keys.verify(id),
      });
      if (row.lead_id) {
        await c.query(
          `INSERT INTO lead_events (org_id, lead_id, type, data)
           VALUES ($1,$2,'outcome_verified',$3::jsonb)`,
          [
            orgId,
            row.lead_id,
            JSON.stringify({ outcome: row.type, decision, by: userId }),
          ],
        );
      }
      return out;
    });
  }

  /** A person records an outcome by hand (idempotent on the client's key). */
  async manual(
    orgId: string,
    userId: string,
    dto: {
      campaignLeadId: string;
      type: 'qualified_reply' | 'booked_call';
      occurredAt: Date;
      reason: string;
      idempotencyKey: string;
    },
  ): Promise<{ id: string; created: boolean }> {
    return withOrgContext(this.pool, orgId, async (c) => {
      const cl = await c.query<{ lead_id: string }>(
        `SELECT lead_id FROM campaign_leads WHERE id = $1`,
        [dto.campaignLeadId],
      );
      if (!cl.rows[0]) throw new NotFoundException('Enrollment not found');
      const r = await this.record(c, orgId, {
        type: dto.type,
        source: 'manual',
        verification: 'verified',
        idempotencyKey: keys.manual(dto.idempotencyKey),
        occurredAt: dto.occurredAt,
        leadId: cl.rows[0].lead_id,
        campaignLeadId: dto.campaignLeadId,
        createdBy: userId,
        verifiedBy: userId,
        reason: dto.reason,
      });
      if (!r) throw new BadRequestException('Could not record the outcome');
      return r;
    });
  }

  // ── reading ──────────────────────────────────────────────────────────────

  private listSql(where: string) {
    return `SELECT o.id, o.type, o.source, o.verification, o.campaign_lead_id,
                   o.lead_id, o.company_key, o.experiment_id, o.variant_id,
                   o.conversation_id, o.occurred_at, o.verified_by, o.verified_at,
                   o.reason, o.created_at,
                   l.email AS lead_email,
                   NULLIF(trim(concat_ws(' ', l.first_name, l.last_name)), '') AS lead_name,
                   l.company AS lead_company,
                   cp.id AS campaign_id, cp.name AS campaign_name,
                   vu.name AS verified_by_name
              FROM v_outcomes_current o
              LEFT JOIN leads l ON l.id = o.lead_id
              LEFT JOIN campaign_leads cl ON cl.id = o.campaign_lead_id
              LEFT JOIN campaigns cp ON cp.id = cl.campaign_id
              LEFT JOIN users vu ON vu.id = o.verified_by
             ${where}
             ORDER BY o.occurred_at DESC LIMIT 200`;
  }

  /** Current outcomes, optionally only the ones waiting for a person. */
  list(
    orgId: string,
    q: { status?: Verification; campaignId?: string; conversationId?: string },
  ) {
    const where: string[] = [`o.type IN ('qualified_reply','booked_call')`];
    const params: unknown[] = [];
    if (q.status) {
      params.push(q.status);
      where.push(`o.verification = $${params.length}`);
    }
    if (q.campaignId) {
      params.push(q.campaignId);
      where.push(`cp.id = $${params.length}`);
    }
    if (q.conversationId) {
      params.push(q.conversationId);
      where.push(`o.conversation_id = $${params.length}`);
    }
    return withOrgContext(
      this.pool,
      orgId,
      async (c) =>
        (
          await c.query<Row>(
            this.listSql(`WHERE ${where.join(' AND ')}`),
            params,
          )
        ).rows,
    );
  }

  /** Replies and results we could not tie to an enrollment (or were ambiguous). */
  unattributed(orgId: string) {
    return withOrgContext(
      this.pool,
      orgId,
      async (c) =>
        (
          await c.query<Row>(
            this.listSql(
              `WHERE o.campaign_lead_id IS NULL
                 AND o.type IN ('reply','qualified_reply','booked_call')`,
            ),
          )
        ).rows,
    );
  }

  /** The history of one outcome (provisional → verified → corrected). */
  history(orgId: string, conversationId: string) {
    return withOrgContext(
      this.pool,
      orgId,
      async (c) =>
        (
          await c.query<Row>(
            `SELECT o.id, o.type, o.source, o.verification, o.occurred_at,
                    o.created_at, o.verified_at, o.reason, o.supersedes_id,
                    vu.name AS verified_by_name
               FROM outcome_events o LEFT JOIN users vu ON vu.id = o.verified_by
              WHERE o.conversation_id = $1
                AND o.type IN ('qualified_reply','booked_call')
              ORDER BY o.created_at`,
            [conversationId],
          )
        ).rows,
    );
  }

  /**
   * outcomeCoverage for an experiment (T04 gate): replying companies inside
   * their response window, and how many of them have nothing still waiting for
   * a person. Late replies are stored but not counted here.
   */
  coverage(orgId: string, experimentId: string) {
    return withOrgContext(this.pool, orgId, async (c) => {
      const r = await c.query<{ replying: number; settled: number }>(
        `WITH win AS (
           SELECT a.company_key, a.assigned_at,
                  a.assigned_at + make_interval(days => e.response_window_days) AS closes
             FROM experiment_assignments a
             JOIN experiments e ON e.id = a.experiment_id
            WHERE a.experiment_id = $1
         ), replying AS (
           SELECT DISTINCT o.company_key
             FROM outcome_events o JOIN win w ON w.company_key = o.company_key
            WHERE o.experiment_id = $1 AND o.type = 'reply'
              AND o.occurred_at <= w.closes
         ), waiting AS (
           SELECT DISTINCT company_key FROM v_outcomes_current
            WHERE experiment_id = $1 AND type = 'qualified_reply'
              AND verification = 'provisional'
         )
         SELECT (SELECT count(*) FROM replying)::int AS replying,
                (SELECT count(*) FROM replying r
                  WHERE r.company_key NOT IN (SELECT company_key FROM waiting))::int
                  AS settled`,
        [experimentId],
      );
      const row = r.rows[0] ?? { replying: 0, settled: 0 };
      return {
        replyingCompanies: row.replying,
        settledCompanies: row.settled,
        coverage: outcomeCoverage({
          replyingCompanies: row.replying,
          settledCompanies: row.settled,
        }),
      };
    });
  }

  // ── rubric ───────────────────────────────────────────────────────────────

  getRubric(orgId: string) {
    return withOrgContext(this.pool, orgId, async (c) => {
      const r = await c.query<{ rubric: string | null }>(
        `SELECT qualification_rubric AS rubric FROM org_knowledge WHERE org_id = $1`,
        [orgId],
      );
      return {
        rubric: r.rows[0]?.rubric ?? DEFAULT_RUBRIC,
        isDefault: !r.rows[0]?.rubric,
      };
    });
  }

  setRubric(orgId: string, rubric: string) {
    return withOrgContext(this.pool, orgId, async (c) => {
      await c.query(
        `INSERT INTO org_knowledge (org_id, qualification_rubric)
         VALUES ($1, $2)
         ON CONFLICT (org_id) DO UPDATE
           SET qualification_rubric = EXCLUDED.qualification_rubric, updated_at = now()`,
        [orgId, rubric.trim()],
      );
      return { rubric: rubric.trim(), isDefault: false };
    });
  }
}

export const DEFAULT_RUBRIC =
  'Qualified = the person shows real interest in what we offer: asks for a call, a demo or pricing, ' +
  'or says they have the problem and want to talk. Not qualified = polite no, out of office, wrong person, ' +
  'or only a question that needs no sales conversation.';

export type { PoolClient };
