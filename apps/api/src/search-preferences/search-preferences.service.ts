import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Pool, PoolClient } from 'pg';
import type { AuthUser } from '../auth/types';
import { OffersService } from '../campaigns/offers.service';
import { PG_POOL } from '../db/db.module';
import { withOrgContext } from '../db/tenant-context';
import { InsightsService } from '../insights/insights.service';
import type { Insight } from '../insights/insight-rules';
import { NotificationsService } from '../notifications/notifications.service';
import {
  type ArmStats,
  autoDeactivateReason,
  DEFAULT_EXPIRY_DAYS,
  decideResults,
  evidenceHash,
  isSearchFactor,
  MAX_CAP_SHARE,
  MAX_EXPIRY_DAYS,
  preferenceLabel,
  RESPONSE_WINDOW_DAYS,
  reservedSlots,
  type ResultVerdict,
  type SearchFactor,
} from './preference-logic';

/**
 * Learning Loop T12: search preferences. A manager approves a bounded test
 * ("find more companies in Pune"); the next Discover runs of that offer
 * reserve at most 20% of a batch for it, for 14 days, and it can be withdrawn
 * or reverted at any time. Code decides everything here; the Insights numbers
 * are recomputed on the server, never taken from the browser.
 */

export interface ProposeInput {
  offerId?: string;
  insightId: string;
  campaignIds?: string[];
  from?: Date;
  to?: Date;
}

export interface Proposal {
  proposalHash: string;
  offerId: string;
  factor: SearchFactor;
  value: string;
  label: string;
  filter: { factor: SearchFactor; value: string };
  mode: 'quota';
  capShare: number;
  expiresInDays: number;
  expiresAt: string;
  /** Slots reserved in a run of 12 and of 20 companies, so the cap is concrete. */
  example: { batch12: number; batch20: number };
  evidence: Evidence;
  staysTheSame: string[];
  warnings: { code: string; message: string; preferenceId?: string }[];
  /** Industry / company size are the model's reading of the site, a weaker match. */
  weakMatch: boolean;
}

export interface Evidence {
  insightId: string;
  metric: string;
  x: number;
  n: number;
  p: number;
  lo: number;
  hi: number;
  overallP: number;
  sentence: string;
  confounding: string | null;
  computedAt: string;
  from: string | null;
  to: string | null;
  source: string;
}

export interface PreferenceView {
  id: string;
  offerId: string;
  factor: SearchFactor;
  value: string;
  label: string;
  mode: string;
  capShare: number;
  startsAt: Date;
  expiresAt: Date;
  status: string;
  revision: number;
  endedAt: Date | null;
  endedReason: string | null;
  evidence: Evidence;
  approvedBy: { id: string; name: string } | null;
  createdAt: Date;
  /** True when this response is the stored result of an earlier identical request. */
  replayed?: boolean;
}

interface PrefRow {
  id: string;
  offer_id: string;
  factor: SearchFactor;
  value: string;
  label: string;
  mode: string;
  cap_share: string;
  starts_at: Date;
  expires_at: Date;
  evidence: Evidence;
  evidence_hash: string;
  approved_by: string | null;
  approved_by_name?: string | null;
  status: string;
  revision: number;
  ended_at: Date | null;
  ended_reason: string | null;
  idempotency_key: string;
  created_at: Date;
}

const PREF_SELECT = `sp.id, sp.offer_id, sp.factor, sp.value, sp.label, sp.mode, sp.cap_share,
  sp.starts_at, sp.expires_at, sp.evidence, sp.evidence_hash, sp.approved_by,
  u.name AS approved_by_name, sp.status, sp.revision, sp.ended_at, sp.ended_reason,
  sp.idempotency_key, sp.created_at
  FROM search_preferences sp LEFT JOIN users u ON u.id = sp.approved_by`;

function assertManager(user: AuthUser): void {
  // @Roles on the controller is the first check; this is the second, because
  // the background caller and every approval re-check the role on the server.
  if (user.role !== 'admin' && user.role !== 'manager') {
    throw new ForbiddenException(
      'Only managers and admins can change a search preference',
    );
  }
}

const fail = (
  status: 400 | 409,
  error: string,
  message: string,
  extra = {},
) => {
  const body = { statusCode: status, error, message, ...extra };
  throw status === 400
    ? new BadRequestException(body)
    : new ConflictException(body);
};

export interface ResultsView {
  preferenceId: string;
  label: string;
  status: string;
  /** Discover runs that pinned this preference (and used it). */
  runs: number;
  targeted: ArmStats & { qualifiedPerRun: number | null };
  baseline: ArmStats & { qualifiedPerRun: number | null };
  windowOpen: boolean;
  verdict: ResultVerdict;
  note: string;
}

@Injectable()
export class SearchPreferencesService {
  private readonly logger = new Logger(SearchPreferencesService.name);

  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    private readonly insights: InsightsService,
    private readonly offers: OffersService,
    private readonly notifications: NotificationsService,
  ) {}

  // ── views ──────────────────────────────────────────────────────────────

  private view(row: PrefRow, replayed = false): PreferenceView {
    return {
      id: row.id,
      offerId: row.offer_id,
      factor: row.factor,
      value: row.value,
      label: row.label,
      mode: row.mode,
      capShare: Number(row.cap_share),
      startsAt: row.starts_at,
      expiresAt: row.expires_at,
      status: row.status,
      revision: row.revision,
      endedAt: row.ended_at,
      endedReason: row.ended_reason,
      evidence: row.evidence,
      approvedBy: row.approved_by
        ? { id: row.approved_by, name: row.approved_by_name ?? 'Unknown' }
        : null,
      createdAt: row.created_at,
      ...(replayed ? { replayed } : {}),
    };
  }

  private async load(c: PoolClient, id: string, lock = false) {
    const r = await c.query<PrefRow>(
      `SELECT ${PREF_SELECT} WHERE sp.id = $1 ${lock ? 'FOR UPDATE OF sp' : ''}`,
      [id],
    );
    if (!r.rows[0]) throw new NotFoundException('Search preference not found');
    return r.rows[0];
  }

  // ── propose ────────────────────────────────────────────────────────────

  /**
   * Recomputes the Insights headline on the server and returns the preview a
   * manager approves: the exact filter, the cap, the expiry, the evidence and
   * what stays the same. Nothing is saved.
   */
  async propose(orgId: string, input: ProposeInput): Promise<Proposal> {
    const offerId = await withOrgContext(this.pool, orgId, (c) =>
      this.offers.resolveOfferIdInTx(c, orgId, input.offerId),
    );
    const res = await this.insights.get(orgId, {
      offerId,
      campaignIds: input.campaignIds,
      from: input.from,
      to: input.to,
    });
    const all: Insight[] = Object.values(res.headlinesByMetric).flat();
    const insight = all.find((i) => i.id === input.insightId && !i.diagnostic);
    if (!insight || !insight.searchable || !isSearchFactor(insight.factor)) {
      return fail(
        409,
        'insight_not_current',
        'That insight is no longer a clear result for this offer, or Discover cannot search for it. Reload the Insights page.',
      );
    }
    const factor = insight.factor;
    const value = insight.bucket;
    const evidence: Evidence = {
      insightId: insight.id,
      metric: insight.metric,
      x: insight.x,
      n: insight.n,
      p: insight.p,
      lo: insight.lo,
      hi: insight.hi,
      overallP: insight.overallP,
      sentence: insight.sentence,
      confounding: insight.confounding,
      computedAt: res.generatedAt,
      from: res.filters.from,
      to: res.filters.to,
      source: res.source,
    };
    const hash = evidenceHash({
      offerId,
      factor,
      value,
      metric: insight.metric,
      x: insight.x,
      n: insight.n,
    });

    const expiresAt = new Date(Date.now() + DEFAULT_EXPIRY_DAYS * 86_400_000);
    const warnings: Proposal['warnings'] = [];
    await withOrgContext(this.pool, orgId, async (c) => {
      const active = await c.query<{ id: string }>(
        `SELECT id FROM search_preferences
          WHERE offer_id = $1 AND status = 'active' AND expires_at > now() LIMIT 1`,
        [offerId],
      );
      if (active.rows[0]) {
        warnings.push({
          code: 'active_preference_exists',
          message:
            'This offer already has an active search preference. Withdraw it first, or wait for it to expire.',
          preferenceId: active.rows[0].id,
        });
      }
      const same = await c.query<{ id: string }>(
        `SELECT id FROM search_preferences
          WHERE offer_id = $1 AND evidence_hash = $2 LIMIT 1`,
        [offerId, hash],
      );
      if (same.rows[0]) {
        warnings.push({
          code: 'same_evidence',
          message:
            'This would re-test the same data. Collect fresh results first.',
          preferenceId: same.rows[0].id,
        });
      }
    });
    const weakMatch = factor === 'industry' || factor === 'size_band';
    if (weakMatch) {
      warnings.push({
        code: 'weak_match',
        message:
          'Industry and company size are the model’s reading of each website, with no quote to check. City, region, country and trigger are checked against the page.',
      });
    }

    return {
      proposalHash: hash,
      offerId,
      factor,
      value,
      label: preferenceLabel(factor, value),
      filter: { factor, value },
      mode: 'quota',
      capShare: MAX_CAP_SHARE,
      expiresInDays: DEFAULT_EXPIRY_DAYS,
      expiresAt: expiresAt.toISOString(),
      example: {
        batch12: reservedSlots(12, MAX_CAP_SHARE),
        batch20: reservedSlots(20, MAX_CAP_SHARE),
      },
      evidence,
      staysTheSame: [
        'The offer and the message',
        'Who is allowed to send, and the sending rules',
        'The normal search, which still fills the rest of every batch',
      ],
      warnings,
      weakMatch,
    };
  }

  // ── create ─────────────────────────────────────────────────────────────

  async create(
    orgId: string,
    user: AuthUser,
    input: ProposeInput & {
      proposalHash: string;
      idempotencyKey: string;
      capShare?: number;
      expiresInDays?: number;
    },
  ): Promise<PreferenceView> {
    assertManager(user);
    const capShare = input.capShare ?? MAX_CAP_SHARE;
    if (!(capShare > 0) || capShare > MAX_CAP_SHARE) {
      return fail(
        400,
        'cap_too_high',
        'A search preference can reserve at most 20% of a batch.',
      );
    }
    const days = input.expiresInDays ?? DEFAULT_EXPIRY_DAYS;
    if (!Number.isInteger(days) || days < 1 || days > MAX_EXPIRY_DAYS) {
      return fail(
        400,
        'expiry_out_of_range',
        `A search preference lasts between 1 and ${MAX_EXPIRY_DAYS} days.`,
      );
    }

    // A retry of a request that already succeeded returns the stored row.
    const replay = await this.replay(orgId, input.idempotencyKey, input);
    if (replay) return replay;

    const proposal = await this.propose(orgId, input);
    if (proposal.proposalHash !== input.proposalHash) {
      return fail(
        409,
        'proposal_changed',
        'The numbers changed since you opened the preview. Please look at the new preview.',
      );
    }

    return withOrgContext(this.pool, orgId, async (c) => {
      // one create per workspace + offer at a time
      await c.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [
        `${orgId}:${proposal.offerId}:search-preference`,
      ]);
      const again = await this.replayInTx(
        c,
        orgId,
        input.idempotencyKey,
        proposal,
      );
      if (again) return again;

      // an active preference past its expiry that the timer has not flipped yet
      await this.expireDueInTx(c, proposal.offerId);

      const active = await c.query<{ id: string }>(
        `SELECT id FROM search_preferences WHERE offer_id = $1 AND status = 'active' LIMIT 1`,
        [proposal.offerId],
      );
      if (active.rows[0]) {
        return fail(
          409,
          'active_preference_exists',
          'This offer already has an active search preference. Withdraw it first, or wait for it to expire.',
          { preferenceId: active.rows[0].id },
        );
      }
      const same = await c.query<{ id: string }>(
        `SELECT id FROM search_preferences WHERE offer_id = $1 AND evidence_hash = $2 LIMIT 1`,
        [proposal.offerId, proposal.proposalHash],
      );
      if (same.rows[0]) {
        return fail(
          409,
          'same_evidence',
          'This would re-test the same data. Collect fresh results first.',
          { preferenceId: same.rows[0].id },
        );
      }

      const ins = await c.query<{ id: string }>(
        `INSERT INTO search_preferences
           (org_id, offer_id, factor, value, label, filter, mode, cap_share,
            expires_at, evidence, evidence_hash, approved_by, idempotency_key)
         VALUES ($1,$2,$3,$4,$5,$6::jsonb,'quota',$7,
                 now() + make_interval(days => $8), $9::jsonb,$10,$11,$12)
         RETURNING id`,
        [
          orgId,
          proposal.offerId,
          proposal.factor,
          proposal.value,
          proposal.label,
          JSON.stringify(proposal.filter),
          capShare,
          days,
          JSON.stringify(proposal.evidence),
          proposal.proposalHash,
          user.userId,
          input.idempotencyKey,
        ],
      );
      const row = await this.load(c, ins.rows[0].id);
      await this.audit(c, orgId, row, 'created', user.userId, null, null, {
        status: 'active',
        capShare,
        expiresAt: row.expires_at,
      });
      this.logger.log(
        `search preference ${row.id} created (${row.factor}=${row.value}, ${capShare * 100}%, ${days}d)`,
      );
      return this.view(row);
    });
  }

  private async replay(
    orgId: string,
    key: string,
    input: ProposeInput & { proposalHash: string },
  ): Promise<PreferenceView | null> {
    return withOrgContext(this.pool, orgId, async (c) => {
      const r = await c.query<PrefRow>(
        `SELECT ${PREF_SELECT} WHERE sp.org_id = $1 AND sp.idempotency_key = $2`,
        [orgId, key],
      );
      const row = r.rows[0];
      if (!row) return null;
      if (row.evidence_hash !== input.proposalHash) {
        return fail(
          409,
          'idempotency_key_reused',
          'This request key was already used for a different preference.',
        );
      }
      return this.view(row, true);
    });
  }

  private async replayInTx(
    c: PoolClient,
    orgId: string,
    key: string,
    proposal: Proposal,
  ): Promise<PreferenceView | null> {
    const r = await c.query<PrefRow>(
      `SELECT ${PREF_SELECT} WHERE sp.org_id = $1 AND sp.idempotency_key = $2`,
      [orgId, key],
    );
    const row = r.rows[0];
    if (!row) return null;
    if (row.evidence_hash !== proposal.proposalHash) {
      return fail(
        409,
        'idempotency_key_reused',
        'This request key was already used for a different preference.',
      );
    }
    return this.view(row, true);
  }

  private async audit(
    c: PoolClient,
    orgId: string,
    row: Pick<PrefRow, 'id' | 'revision'>,
    action: string,
    actor: string | null,
    reason: string | null,
    before: unknown,
    after: unknown,
  ) {
    await c.query(
      `INSERT INTO search_preference_revisions
         (org_id, preference_id, revision, action, before, after, actor, reason)
       VALUES ($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7,$8)`,
      [
        orgId,
        row.id,
        row.revision,
        action,
        JSON.stringify(before ?? null),
        JSON.stringify(after ?? null),
        actor,
        reason,
      ],
    );
  }

  /** Flips this offer's overdue preference to expired (same effect as the timer). */
  private async expireDueInTx(c: PoolClient, offerId: string) {
    const r = await c.query<{ id: string; org_id: string; revision: number }>(
      `UPDATE search_preferences
          SET status = 'expired', ended_at = now(),
              ended_reason = 'Reached its expiry date', revision = revision + 1
        WHERE offer_id = $1 AND status = 'active' AND expires_at <= now()
        RETURNING id, org_id, revision`,
      [offerId],
    );
    for (const e of r.rows) {
      await this.audit(
        c,
        e.org_id,
        e,
        'expired',
        null,
        'Reached its expiry date',
        { status: 'active' },
        { status: 'expired' },
      );
    }
  }

  // ── read ───────────────────────────────────────────────────────────────

  async list(orgId: string, offerId?: string): Promise<PreferenceView[]> {
    return withOrgContext(this.pool, orgId, async (c) => {
      const r = await c.query<PrefRow>(
        `SELECT ${PREF_SELECT}
          WHERE ($1::uuid IS NULL OR sp.offer_id = $1)
          ORDER BY (sp.status = 'active') DESC, sp.created_at DESC
          LIMIT 50`,
        [offerId ?? null],
      );
      return r.rows.map((row) => this.view(row));
    });
  }

  async get(orgId: string, id: string) {
    return withOrgContext(this.pool, orgId, async (c) => {
      const row = await this.load(c, id);
      const revisions = await c.query(
        `SELECT r.revision, r.action, r.before, r.after, r.reason, r.created_at,
                u.name AS actor_name
           FROM search_preference_revisions r LEFT JOIN users u ON u.id = r.actor
          WHERE r.preference_id = $1 ORDER BY r.created_at ASC, r.revision ASC`,
        [id],
      );
      const runs = await c.query(
        `SELECT id, goal, status, requested, verified, allocation, created_at
           FROM prospect_runs WHERE preference_id = $1
          ORDER BY created_at DESC LIMIT 20`,
        [id],
      );
      return {
        ...this.view(row),
        revisions: revisions.rows,
        runs: runs.rows,
      };
    });
  }

  // ── withdraw / revert ──────────────────────────────────────────────────

  withdraw(orgId: string, user: AuthUser, id: string, reason?: string) {
    return this.end(orgId, user, id, 'withdrawn', reason);
  }

  revert(orgId: string, user: AuthUser, id: string, reason?: string) {
    return this.end(orgId, user, id, 'reverted', reason);
  }

  /**
   * Stops a preference at once: new Discover runs no longer see it. A run
   * that already started keeps its pin. Reverting also records what happened
   * to the offer's search profile: in quota mode the preference never changed
   * it, so there is nothing to restore (a deliberate no-op).
   */
  private async end(
    orgId: string,
    user: AuthUser,
    id: string,
    status: 'withdrawn' | 'reverted',
    reason?: string,
  ): Promise<PreferenceView> {
    assertManager(user);
    return withOrgContext(this.pool, orgId, async (c) => {
      const cur = await this.load(c, id, true);
      if (cur.status !== 'active') {
        return fail(
          409,
          'not_active',
          `This preference is already ${cur.status}.`,
        );
      }
      const why = reason?.trim() || null;
      await c.query(
        `UPDATE search_preferences
            SET status = $2, ended_at = now(), ended_reason = $3, revision = revision + 1
          WHERE id = $1`,
        [
          id,
          status,
          why ?? (status === 'withdrawn' ? 'Withdrawn' : 'Reverted'),
        ],
      );
      const row = await this.load(c, id);
      await this.audit(
        c,
        orgId,
        row,
        status,
        user.userId,
        why,
        { status: 'active' },
        status === 'reverted'
          ? {
              status,
              priorProfileRestored: false,
              note: 'Quota mode never changed the offer’s search profile, so there was nothing to restore.',
            }
          : { status },
      );
      return this.view(row);
    });
  }

  // ── background: expiry + auto-deactivate ───────────────────────────────

  /**
   * One pass of the 15-minute timer: flip overdue preferences (the database
   * function does it atomically, so two instances never double-flip), then
   * check the rollback thresholds of the active ones.
   */
  async runDue(): Promise<{ expired: number; deactivated: number }> {
    const expired = await this.expireDue();
    const deactivated = await this.checkGuardrails();
    return { expired, deactivated };
  }

  async expireDue(): Promise<number> {
    const r = await this.pool.query<{
      id: string;
      org_id: string;
      label: string;
    }>(`SELECT id, org_id, label FROM expire_search_preferences()`);
    for (const e of r.rows) {
      await withOrgContext(this.pool, e.org_id, (c) =>
        this.notifications.notifyOrg(c, e.org_id, {
          type: 'search_preference',
          title: `Search preference ended: ${e.label}`,
          body: 'It reached its expiry date. Open Discover to see how it did.',
          link: '/discover',
        }),
      ).catch((err: unknown) =>
        this.logger.warn(
          `expiry notification failed: ${err instanceof Error ? err.message : String(err)}`,
        ),
      );
    }
    if (r.rows.length > 0) {
      this.logger.log(`${r.rows.length} search preference(s) expired`);
    }
    return r.rows.length;
  }

  async checkGuardrails(): Promise<number> {
    const active = await this.pool.query<{ id: string; org_id: string }>(
      `SELECT id, org_id FROM active_search_preferences()`,
    );
    let n = 0;
    for (const a of active.rows) {
      try {
        if (await this.deactivateIfUnsafe(a.org_id, a.id)) n += 1;
      } catch (err) {
        this.logger.warn(
          `guardrail check failed for ${a.id}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
    return n;
  }

  private async deactivateIfUnsafe(
    orgId: string,
    id: string,
  ): Promise<boolean> {
    const res = await this.results(orgId, id);
    const pref = await withOrgContext(this.pool, orgId, (c) =>
      this.load(c, id),
    );
    const ageDays = (Date.now() - pref.starts_at.getTime()) / 86_400_000;
    const why = autoDeactivateReason(res.targeted, res.baseline, ageDays);
    if (!why) return false;
    return withOrgContext(this.pool, orgId, async (c) => {
      const cur = await this.load(c, id, true);
      if (cur.status !== 'active') return false;
      await c.query(
        `UPDATE search_preferences
            SET status = 'deactivated', ended_at = now(), ended_reason = $2,
                revision = revision + 1
          WHERE id = $1`,
        [id, why],
      );
      const row = await this.load(c, id);
      await this.audit(
        c,
        orgId,
        row,
        'deactivated',
        null,
        why,
        { status: 'active' },
        { status: 'deactivated' },
      );
      await this.notifications.notifyOrg(c, orgId, {
        type: 'search_preference',
        title: `Search preference switched off: ${row.label}`,
        body: why,
        link: '/discover',
      });
      this.logger.warn(`search preference ${id} deactivated: ${why}`);
      return true;
    });
  }

  // ── did it work? ───────────────────────────────────────────────────────

  /**
   * Targeted vs baseline leads from the SAME Discover runs, counted as
   * companies and read the way Review reads them (confirmed qualified replies
   * inside the 14-day window, bounced companies are not "reached").
   */
  async results(orgId: string, id: string): Promise<ResultsView> {
    return withOrgContext(this.pool, orgId, async (c) => {
      const pref = await this.load(c, id);
      const runs = await c.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM prospect_runs
          WHERE preference_id = $1
            AND COALESCE(allocation->>'skipped', '') = ''`,
        [id],
      );
      const blank = (): ArmStats => ({
        discovered: 0,
        contactable: 0,
        sent: 0,
        reached: 0,
        bounced: 0,
        qualified: 0,
        positive: 0,
      });
      const arms = { targeted: blank(), baseline: blank() };

      const pro = await c.query<{
        targeted: boolean;
        discovered: number;
        contactable: number;
      }>(
        `SELECT p.via_preference AS targeted,
                count(*)::int AS discovered,
                count(*) FILTER (WHERE EXISTS (
                  SELECT 1 FROM jsonb_array_elements(p.emails) e
                   WHERE (e->>'mx')::boolean))::int AS contactable
           FROM prospects p
          WHERE p.status = 'verified'
            AND p.run_id IN (SELECT id FROM prospect_runs WHERE preference_id = $1::uuid)
          GROUP BY p.via_preference`,
        [id],
      );
      for (const r of pro.rows) {
        const a = r.targeted ? arms.targeted : arms.baseline;
        a.discovered = r.discovered;
        a.contactable = r.contactable;
      }

      const co = await c.query<{
        targeted: boolean;
        first_sent: Date;
        bounced: boolean;
        positive: boolean;
        qualified: boolean;
      }>(
        `WITH enrol AS (
           SELECT cl.id AS cl_id, cl.campaign_id,
                  cl.snapshot->>'company_key' AS company_key,
                  COALESCE((cl.snapshot->>'preference_id') = $1::uuid::text, false) AS targeted
             FROM campaign_leads cl
            WHERE (cl.snapshot->>'discovery_run_id') IN
                    (SELECT id::text FROM prospect_runs WHERE preference_id = $1::uuid)
              AND cl.snapshot->>'company_key' IS NOT NULL
         ), companies AS (
           SELECT DISTINCT ON (e.targeted, e.company_key)
                  e.targeted, e.company_key, e.campaign_id, se.sent_at AS first_sent
             FROM enrol e
             JOIN sent_emails se ON se.campaign_lead_id = e.cl_id AND se.status = 'sent'
            ORDER BY e.targeted, e.company_key, se.sent_at
         )
         SELECT c.targeted, c.first_sent,
                COALESCE(oc.bounced, false) AS bounced,
                COALESCE(oc.positive, false) AS positive,
                COALESCE(oc.qualified, false) AS qualified
           FROM companies c
           LEFT JOIN LATERAL (
             SELECT bool_or(o.type = 'bounce') AS bounced,
                    bool_or(o.type = 'qualified_reply'
                            AND o.verification IN ('provisional','verified')) AS positive,
                    bool_or(o.type = 'qualified_reply' AND o.verification = 'verified'
                            AND o.occurred_at <= c.first_sent + make_interval(days => $2)) AS qualified
               FROM v_outcomes_current o
               JOIN campaign_leads ocl ON ocl.id = o.campaign_lead_id
              WHERE o.company_key = c.company_key AND ocl.campaign_id = c.campaign_id
           ) oc ON true`,
        [id, RESPONSE_WINDOW_DAYS],
      );
      let windowOpen = false;
      const windowMs = RESPONSE_WINDOW_DAYS * 86_400_000;
      for (const r of co.rows) {
        const a = r.targeted ? arms.targeted : arms.baseline;
        a.sent += 1;
        if (r.bounced) a.bounced += 1;
        else {
          a.reached += 1;
          if (r.qualified) a.qualified += 1;
          if (r.positive) a.positive += 1;
        }
        if (r.first_sent.getTime() + windowMs > Date.now()) windowOpen = true;
      }

      const verdict = decideResults(arms.targeted, arms.baseline, {
        windowOpen,
      });
      const runCount = runs.rows[0].n;
      const perRun = (q: number) => (runCount > 0 ? q / runCount : null);
      return {
        preferenceId: id,
        label: pref.label,
        status: pref.status,
        runs: runCount,
        targeted: {
          ...arms.targeted,
          qualifiedPerRun: perRun(arms.targeted.qualified),
        },
        baseline: {
          ...arms.baseline,
          qualifiedPerRun: perRun(arms.baseline.qualified),
        },
        windowOpen,
        verdict,
        note: 'Companies, not emails. Exploratory: one test is a hint, never proof.',
      };
    });
  }
}
