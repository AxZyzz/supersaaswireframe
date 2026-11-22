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
import { PG_POOL } from '../db/db.module';
import { withOrgContext } from '../db/tenant-context';
import type { ReviewResult } from '../review/policy/types';
import {
  EMBEDDING_PROVIDER,
  type EmbeddingProvider,
} from './embedding.provider';
import {
  buildPreferenceDraft,
  buildReviewDraft,
  PlaybookDrafter,
} from './playbook-drafter';
import type { PlaybookRetriever } from './playbook-retriever';
import {
  DEFAULT_TOP_K,
  DEFAULT_VALID_DAYS,
  embeddingText,
  hintFrom,
  MAX_BODY,
  MAX_TITLE,
  MAX_VALID_DAYS,
  MIN_BODY,
  MIN_TITLE,
  type PlaybookDraft,
  type PlaybookEvidence,
  type PlaybookHint,
  type PlaybookKind,
  type PlaybookSegment,
  type PlaybookStatus,
  type PlaybookView,
  type VectorStatus,
} from './playbook.types';
import {
  PLAYBOOK_VECTOR_STORE,
  type PlaybookVectorStore,
} from './vector-store';

export const PLAYBOOK_RETRIEVER = Symbol('PLAYBOOK_RETRIEVER');

const bad = (error: string, message: string): never => {
  throw new BadRequestException({ statusCode: 400, error, message });
};
const conflict = (error: string, message: string): never => {
  throw new ConflictException({ statusCode: 409, error, message });
};
const missing = (what: string): never => {
  throw new NotFoundException(`${what} not found`);
};

function assertManager(user: AuthUser): void {
  // The controller has @Roles too; this is the second, server-side check.
  if (user.role !== 'admin' && user.role !== 'manager') {
    throw new ForbiddenException(
      'Only managers and admins can save or change playbooks',
    );
  }
}

interface PlaybookRow {
  id: string;
  org_id: string;
  offer_id: string;
  offer_name: string | null;
  kind: PlaybookKind;
  segment: PlaybookSegment | null;
  title: string;
  body: string;
  evidence: PlaybookEvidence;
  valid_from: Date;
  valid_to: Date;
  version: number;
  supersedes_id: string | null;
  status: PlaybookStatus;
  vector_status: VectorStatus;
  created_by: string | null;
  created_by_name: string | null;
  created_at: Date;
  retired_at: Date | null;
}

const SELECT = `SELECT p.id, p.org_id, p.offer_id, o.name AS offer_name, p.kind, p.segment,
    p.title, p.body, p.evidence, p.valid_from, p.valid_to, p.version, p.supersedes_id,
    p.status, p.vector_status, p.created_by, u.name AS created_by_name, p.created_at, p.retired_at
  FROM playbooks p
  JOIN offers o ON o.id = p.offer_id
  LEFT JOIN users u ON u.id = p.created_by`;

export interface CreatePlaybookInput {
  title: string;
  body: string;
  validDays?: number;
  /** Where the learning comes from: exactly one of these. */
  reviewId?: string;
  preferenceId?: string;
}

export interface EditPlaybookInput {
  title: string;
  body: string;
  validDays?: number;
}

const addDays = (d: Date, days: number) =>
  new Date(d.getTime() + days * 86_400_000);

function validDays(v: number | undefined): number {
  const n = v ?? DEFAULT_VALID_DAYS;
  if (!Number.isInteger(n) || n < 1 || n > MAX_VALID_DAYS) {
    bad('valid_days', `Validity must be 1 to ${MAX_VALID_DAYS} days.`);
  }
  return n;
}

function validText(
  title: string,
  body: string,
): { title: string; body: string } {
  const t = title.trim().replace(/\s+/g, ' ');
  const b = body.trim();
  if (t.length < MIN_TITLE || t.length > MAX_TITLE) {
    bad('title', `The title must be ${MIN_TITLE} to ${MAX_TITLE} characters.`);
  }
  if (b.length < MIN_BODY || b.length > MAX_BODY) {
    bad('body', `The text must be ${MIN_BODY} to ${MAX_BODY} characters.`);
  }
  return { title: t, body: b };
}

/**
 * Playbook memory (Learning Loop T14). A manager saves what an approved result
 * taught; the text stays in Postgres (RLS), a vector copy goes to BigQuery, and
 * future Discover runs and challenger drafts get the top few as hints.
 *
 * Editing never rewrites history: it inserts a new version and marks the old
 * one superseded. Every retrieved id is re-checked here against Postgres
 * (workspace, offer, active, not expired), so the vector index can be wrong
 * or stale without ever surfacing the wrong text.
 */
@Injectable()
export class PlaybooksService {
  private readonly logger = new Logger(PlaybooksService.name);

  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    @Inject(EMBEDDING_PROVIDER) private readonly embeddings: EmbeddingProvider,
    @Inject(PLAYBOOK_VECTOR_STORE) private readonly store: PlaybookVectorStore,
    @Inject(PLAYBOOK_RETRIEVER) private readonly retriever: PlaybookRetriever,
    private readonly drafter: PlaybookDrafter,
  ) {}

  private view(r: PlaybookRow): PlaybookView {
    return {
      id: r.id,
      offerId: r.offer_id,
      offerName: r.offer_name,
      kind: r.kind,
      segment: r.segment,
      title: r.title,
      body: r.body,
      evidence: r.evidence,
      validFrom: r.valid_from,
      validTo: r.valid_to,
      version: r.version,
      supersedesId: r.supersedes_id,
      status: r.status,
      vectorStatus: r.vector_status,
      createdBy: r.created_by
        ? { id: r.created_by, name: r.created_by_name ?? 'Unknown' }
        : null,
      createdAt: r.created_at,
      retiredAt: r.retired_at,
      expired: r.valid_to.getTime() <= Date.now(),
    };
  }

  // ── reading ────────────────────────────────────────────────────────────

  /** Current playbooks (every version chain's latest), active first. */
  async list(
    orgId: string,
    opts: { offerId?: string } = {},
  ): Promise<PlaybookView[]> {
    return withOrgContext(this.pool, orgId, async (c) => {
      const rows = await c.query<PlaybookRow>(
        `${SELECT}
          WHERE p.status <> 'superseded'
            AND ($1::uuid IS NULL OR p.offer_id = $1)
          ORDER BY (p.status = 'active' AND p.valid_to > now()) DESC, p.created_at DESC
          LIMIT 200`,
        [opts.offerId ?? null],
      );
      return rows.rows.map((r) => this.view(r));
    });
  }

  async get(orgId: string, id: string): Promise<PlaybookView> {
    return withOrgContext(this.pool, orgId, async (c) => {
      const r = await c.query<PlaybookRow>(`${SELECT} WHERE p.id = $1`, [id]);
      if (!r.rows[0]) return missing('Playbook');
      return this.view(r.rows[0]);
    });
  }

  /** Every version of one playbook, newest first. */
  async versions(orgId: string, id: string): Promise<PlaybookView[]> {
    return withOrgContext(this.pool, orgId, async (c) => {
      const rows = await c.query<PlaybookRow>(
        `WITH RECURSIVE up AS (
           SELECT id, supersedes_id FROM playbooks WHERE id = $1
           UNION ALL
           SELECT p.id, p.supersedes_id FROM playbooks p JOIN up ON p.id = up.supersedes_id
         ), down AS (
           SELECT id FROM playbooks WHERE id = $1
           UNION ALL
           SELECT p.id FROM playbooks p JOIN down ON p.supersedes_id = down.id
         )
         ${SELECT}
          WHERE p.id IN (SELECT id FROM up UNION SELECT id FROM down)
          ORDER BY p.version DESC`,
        [id],
      );
      if (rows.rows.length === 0) return missing('Playbook');
      return rows.rows.map((r) => this.view(r));
    });
  }

  /** Titles for ids a run or draft stored ("Used 2 playbooks"). Old versions still resolve. */
  async titles(
    orgId: string,
    ids: string[],
  ): Promise<Array<{ id: string; title: string }>> {
    const clean = ids.filter((i) => /^[0-9a-f-]{36}$/i.test(i)).slice(0, 10);
    if (clean.length === 0) return [];
    return withOrgContext(this.pool, orgId, async (c) => {
      const r = await c.query<{ id: string; title: string }>(
        `SELECT id, title FROM playbooks WHERE id = ANY($1::uuid[])`,
        [clean],
      );
      const byId = new Map(r.rows.map((x) => [x.id, x.title]));
      return clean
        .filter((i) => byId.has(i))
        .map((i) => ({ id: i, title: byId.get(i) as string }));
    });
  }

  // ── drafting (nothing is saved here) ───────────────────────────────────

  /** A prefilled "Save as playbook" for a promotion a manager approved. */
  async draftFromReview(
    orgId: string,
    user: AuthUser,
    reviewId: string,
  ): Promise<PlaybookDraft> {
    assertManager(user);
    const base = await withOrgContext(this.pool, orgId, (c) =>
      this.reviewBase(c, reviewId),
    );
    return this.drafter.polish(orgId, base);
  }

  /** A prefilled "Save as playbook" for a search preference that is running or has run. */
  async draftFromPreference(
    orgId: string,
    user: AuthUser,
    preferenceId: string,
  ): Promise<PlaybookDraft> {
    assertManager(user);
    const base = await withOrgContext(this.pool, orgId, (c) =>
      this.preferenceBase(c, preferenceId),
    );
    return this.drafter.polish(orgId, base);
  }

  /** The code-built draft for a review. Throws 400/409 unless the promotion was approved. */
  private async reviewBase(c: PoolClient, reviewId: string) {
    const r = await c.query<{
      id: string;
      revision: number;
      simulated: boolean;
      result: ReviewResult;
      computed_at: Date;
      experiment_id: string;
      offer_ref: string | null;
      campaign_offer_id: string | null;
    }>(
      `SELECT r.id, r.revision, r.simulated, r.result, r.computed_at, e.id AS experiment_id,
              e.offer_ref, cp.offer_id AS campaign_offer_id
         FROM reviews r
         JOIN experiments e ON e.id = r.experiment_id
         JOIN campaigns cp ON cp.id = e.campaign_id
        WHERE r.id = $1`,
      [reviewId],
    );
    const rv = r.rows[0];
    if (!rv) return missing('Review');
    if (rv.simulated) {
      return bad(
        'simulated',
        'A simulated review is not your data, so it cannot become a playbook.',
      );
    }
    const res = rv.result;
    if (res.decision !== 'promote' || !res.winnerVariantId || !res.lift) {
      return conflict(
        'not_promoted',
        'Only a result the policy recommends keeping (a promoted version) can be saved as a playbook.',
      );
    }
    const approved = await c.query(
      `SELECT 1 FROM review_actions
        WHERE experiment_id = $1 AND type = 'pause_variant'
          AND status = 'applied' AND reverted_at IS NULL LIMIT 1`,
      [rv.experiment_id],
    );
    if (approved.rows.length === 0) {
      return conflict(
        'not_approved',
        'Approve the promotion first (pause the losing version), then save what you learned.',
      );
    }
    const offerId = rv.offer_ref ?? rv.campaign_offer_id;
    if (!offerId) {
      return bad(
        'no_offer',
        'This test has no offer, and a playbook belongs to an offer.',
      );
    }
    const winner = res.arms.find((a) => a.variantId === res.winnerVariantId);
    const control = res.arms.find((a) => a.isControl);
    if (!winner || !control) {
      return conflict('no_numbers', 'The review has no numbers to learn from.');
    }
    const subjects = await c.query<{ id: string; subject: string }>(
      `SELECT id, subject FROM experiment_variants WHERE experiment_id = $1`,
      [rv.experiment_id],
    );
    const winnerSubject =
      subjects.rows.find((s) => s.id === winner.variantId)?.subject ?? '';
    const offer = await c.query<{ name: string }>(
      `SELECT name FROM offers WHERE id = $1`,
      [offerId],
    );
    return buildReviewDraft({
      offerId,
      offerName: offer.rows[0]?.name ?? 'this offer',
      reviewId: rv.id,
      revision: rv.revision,
      experimentId: rv.experiment_id,
      decision: res.decision,
      winner,
      control,
      lift: res.lift,
      winnerSubject,
      findings: res.findings,
      computedAt: rv.computed_at.toISOString(),
    });
  }

  private async preferenceBase(c: PoolClient, preferenceId: string) {
    const r = await c.query<{
      id: string;
      offer_id: string;
      factor: string;
      value: string;
      label: string;
      status: string;
      evidence: {
        metric: string;
        x: number;
        n: number;
        p: number;
        lo: number;
        hi: number;
        overallP: number;
        confounding: string | null;
        computedAt: string;
      };
    }>(
      `SELECT id, offer_id, factor, value, label, status, evidence
         FROM search_preferences WHERE id = $1`,
      [preferenceId],
    );
    const p = r.rows[0];
    if (!p) return missing('Search preference');
    if (p.status !== 'active' && p.status !== 'expired') {
      return conflict(
        'preference_ended',
        'This preference was withdrawn, reverted or switched off, so it is not a lesson to keep.',
      );
    }
    const e = p.evidence;
    return buildPreferenceDraft({
      offerId: p.offer_id,
      preferenceId: p.id,
      segment: { factor: p.factor, value: p.value },
      label: p.label,
      metric: e.metric,
      x: e.x,
      n: e.n,
      p: e.p,
      lo: e.lo,
      hi: e.hi,
      overallP: e.overallP,
      confounding: e.confounding,
      computedAt: e.computedAt,
    });
  }

  // ── saving ─────────────────────────────────────────────────────────────

  /**
   * Saves a playbook. The evidence, the offer and (for audience playbooks) the
   * segment are rebuilt HERE from the review or preference; only the words and
   * the validity come from the person.
   */
  async create(
    orgId: string,
    user: AuthUser,
    input: CreatePlaybookInput,
  ): Promise<PlaybookView> {
    assertManager(user);
    if (!!input.reviewId === !!input.preferenceId) {
      bad(
        'source',
        'A playbook comes from one review or one search preference.',
      );
    }
    const text = validText(input.title, input.body);
    const days = validDays(input.validDays);
    const saved = await withOrgContext(this.pool, orgId, async (c) => {
      const base = input.reviewId
        ? await this.reviewBase(c, input.reviewId)
        : await this.preferenceBase(c, input.preferenceId as string);
      const now = new Date();
      try {
        const ins = await c.query<{ id: string }>(
          `INSERT INTO playbooks
             (org_id, offer_id, kind, segment, title, body, evidence, valid_from, valid_to, created_by)
           VALUES ($1,$2,$3,$4::jsonb,$5,$6,$7::jsonb,$8,$9,$10) RETURNING id`,
          [
            orgId,
            base.offerId,
            base.kind,
            base.segment ? JSON.stringify(base.segment) : null,
            text.title,
            text.body,
            JSON.stringify(base.evidence),
            now,
            addDays(now, days),
            user.userId,
          ],
        );
        return ins.rows[0].id;
      } catch (e) {
        if ((e as { code?: string }).code === '23505') {
          return conflict(
            'duplicate',
            'You already saved a playbook with this title for this offer.',
          );
        }
        throw e;
      }
    });
    const pb = await this.get(orgId, saved);
    await this.index(orgId, pb);
    return this.get(orgId, saved);
  }

  /** Editing = a new version. The old one stays, marked superseded. */
  async edit(
    orgId: string,
    user: AuthUser,
    id: string,
    input: EditPlaybookInput,
  ): Promise<PlaybookView> {
    assertManager(user);
    const text = validText(input.title, input.body);
    const days = validDays(input.validDays);
    const next = await withOrgContext(this.pool, orgId, async (c) => {
      const cur = await c.query<PlaybookRow>(
        `${SELECT} WHERE p.id = $1 FOR UPDATE OF p`,
        [id],
      );
      const old = cur.rows[0];
      if (!old) return missing('Playbook');
      if (old.status !== 'active') {
        return conflict(
          'not_active',
          'Only the current, active version can be edited. Retired or replaced ones stay as history.',
        );
      }
      const now = new Date();
      // the old version steps aside first, so the title stays unique among active rows
      await c.query(
        `UPDATE playbooks SET status = 'superseded' WHERE id = $1`,
        [id],
      );
      try {
        const ins = await c.query<{ id: string }>(
          `INSERT INTO playbooks
             (org_id, offer_id, kind, segment, title, body, evidence, valid_from, valid_to,
              version, supersedes_id, created_by)
           VALUES ($1,$2,$3,$4::jsonb,$5,$6,$7::jsonb,$8,$9,$10,$11,$12) RETURNING id`,
          [
            orgId,
            old.offer_id,
            old.kind,
            old.segment ? JSON.stringify(old.segment) : null,
            text.title,
            text.body,
            JSON.stringify(old.evidence),
            now,
            addDays(now, days),
            old.version + 1,
            old.id,
            user.userId,
          ],
        );
        return ins.rows[0].id;
      } catch (e) {
        if ((e as { code?: string }).code === '23505') {
          return conflict(
            'duplicate',
            'Another playbook for this offer already has that title, or someone edited this one at the same time. Reload and try again.',
          );
        }
        throw e;
      }
    });
    // the old version's vector goes; the new one is indexed
    await this.dropVector(orgId, id);
    const pb = await this.get(orgId, next);
    await this.index(orgId, pb);
    return this.get(orgId, next);
  }

  async retire(
    orgId: string,
    user: AuthUser,
    id: string,
  ): Promise<PlaybookView> {
    assertManager(user);
    await withOrgContext(this.pool, orgId, async (c) => {
      const cur = await c.query<{ status: string }>(
        `SELECT status FROM playbooks WHERE id = $1 FOR UPDATE`,
        [id],
      );
      if (!cur.rows[0]) return missing('Playbook');
      if (cur.rows[0].status !== 'active') {
        return conflict(
          'not_active',
          'This playbook is already retired or replaced.',
        );
      }
      await c.query(
        `UPDATE playbooks SET status = 'retired', retired_at = now(), retired_by = $2 WHERE id = $1`,
        [id, user.userId],
      );
    });
    await this.dropVector(orgId, id);
    return this.get(orgId, id);
  }

  /** Admin: (re)build the vector copy of every active playbook that has none yet. */
  async reindex(
    orgId: string,
    user: AuthUser,
  ): Promise<{ indexed: number; failed: number; skipped: boolean }> {
    if (user.role !== 'admin') {
      throw new ForbiddenException(
        'Only admins can rebuild the playbook index',
      );
    }
    if (this.store.name === 'none') {
      return { indexed: 0, failed: 0, skipped: true };
    }
    const rows = await withOrgContext(this.pool, orgId, async (c) => {
      const r = await c.query<PlaybookRow>(
        `${SELECT} WHERE p.status = 'active' AND p.valid_to > now()
           AND p.vector_status <> 'indexed' ORDER BY p.created_at LIMIT 50`,
      );
      return r.rows.map((x) => this.view(x));
    });
    let indexed = 0;
    let failed = 0;
    for (const pb of rows) {
      if ((await this.index(orgId, pb)) === 'indexed') indexed++;
      else failed++;
    }
    return { indexed, failed, skipped: false };
  }

  // ── the vector copy ────────────────────────────────────────────────────

  private async setVectorStatus(orgId: string, id: string, s: VectorStatus) {
    await withOrgContext(this.pool, orgId, (c) =>
      c.query(`UPDATE playbooks SET vector_status = $2 WHERE id = $1`, [id, s]),
    );
  }

  /** Embeds the playbook and stores its vector. A failure never blocks saving: the keyword search still finds it. */
  private async index(orgId: string, pb: PlaybookView): Promise<VectorStatus> {
    if (this.store.name === 'none') return 'pending';
    try {
      const embedding = await this.embeddings.embed(
        embeddingText(pb),
        'RETRIEVAL_DOCUMENT',
      );
      await this.store.upsert({
        orgId,
        playbookId: pb.id,
        version: pb.version,
        offerId: pb.offerId,
        embedding,
        validTo: pb.validTo,
      });
      await this.setVectorStatus(orgId, pb.id, 'indexed');
      return 'indexed';
    } catch (e) {
      this.logger.warn(
        `playbook ${pb.id}: vector copy failed: ${(e as Error).message}`,
      );
      await this.setVectorStatus(orgId, pb.id, 'failed').catch(() => undefined);
      return 'failed';
    }
  }

  private async dropVector(orgId: string, id: string): Promise<void> {
    try {
      await this.store.remove(orgId, id);
    } catch (e) {
      // the Postgres re-check keeps a leftover vector from ever being used
      this.logger.warn(
        `playbook ${id}: removing its vector failed: ${(e as Error).message}`,
      );
    }
  }

  // ── using them ─────────────────────────────────────────────────────────

  /**
   * The most relevant active, unexpired playbooks of one offer for a request.
   * Never throws: a request without hints is better than a failed run.
   */
  async relevant(
    orgId: string,
    q: { offerId: string | null; text: string; k?: number },
  ): Promise<PlaybookHint[]> {
    if (!q.offerId || !q.text.trim()) return [];
    const k = Math.max(1, Math.min(q.k ?? DEFAULT_TOP_K, 10));
    try {
      const ids = await this.retriever.retrieve({
        orgId,
        offerId: q.offerId,
        text: q.text,
        k,
      });
      if (ids.length === 0) return [];
      // the Postgres re-check: this workspace, this offer, active, not expired
      return await withOrgContext(this.pool, orgId, async (c) => {
        const r = await c.query<{
          id: string;
          title: string;
          body: string;
          valid_to: Date;
        }>(
          `SELECT id, title, body, valid_to FROM playbooks
            WHERE id = ANY($1::uuid[]) AND offer_id = $2
              AND status = 'active' AND valid_to > now()`,
          [ids, q.offerId],
        );
        const byId = new Map(r.rows.map((x) => [x.id, x]));
        return ids
          .map((i) => byId.get(i))
          .filter((x): x is NonNullable<typeof x> => !!x)
          .slice(0, k)
          .map((x) => hintFrom({ ...x, validTo: x.valid_to }));
      });
    } catch (e) {
      this.logger.warn(
        `playbooks: lookup failed, continuing without hints: ${(e as Error).message}`,
      );
      return [];
    }
  }
}
