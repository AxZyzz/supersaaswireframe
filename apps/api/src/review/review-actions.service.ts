import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Pool, PoolClient } from 'pg';
import {
  DEFAULT_GUARDRAILS,
  ExperimentsService,
} from '../campaigns/experiments.service';
import type { AuthUser } from '../auth/types';
import { PG_POOL } from '../db/db.module';
import { withOrgContext } from '../db/tenant-context';
import {
  CHALLENGER_DRAFTER,
  cleanSubject,
  type ChallengerDrafter,
} from './challenger-drafter';
import type { AllowedAction, ReviewResult } from './policy';

/**
 * Learning Loop T11: what a person can DO with a review.
 *
 * Every action:
 *  - is tied to a review REVISION (a stale one is a 409, "Results changed");
 *  - carries an IDEMPOTENCY KEY (a retry returns the stored row, never a
 *    second change);
 *  - runs in ONE transaction that first locks the experiment row, so two
 *    competing approvals line up one behind the other;
 *  - re-checks the role on the server;
 *  - stores before / after JSON, who asked, who approved and when.
 *
 * Code decides, AI drafts, people approve: the AI only ever supplies the draft
 * subjects (ChallengerDrafter); nothing here trusts it beyond that.
 */

export type StoredActionType =
  'keep_testing' | 'pause_variant' | 'resume_variant' | 'approve_challenger';

export interface ActionView {
  id: string;
  reviewId: string;
  experimentId: string;
  revision: number;
  actionId: string;
  type: StoredActionType;
  status: string;
  payload: Record<string, unknown>;
  reason: string | null;
  requestedBy: { id: string; name: string } | null;
  approvedBy: { id: string; name: string } | null;
  before: unknown;
  after: unknown;
  requestedAt: Date;
  appliedAt: Date | null;
  revertedAt: Date | null;
  revertsActionId: string | null;
  /** True when "Undo" would work right now (pause / resume of a running test). */
  canRevert: boolean;
  /** True when this response is the stored result of an earlier identical request. */
  replayed: boolean;
}

export interface DraftView {
  id: string;
  subject: string;
  source: string;
  createdAt: Date;
}

interface ActionRow {
  id: string;
  review_id: string;
  experiment_id: string;
  revision: number;
  action_id: string;
  type: StoredActionType;
  payload: Record<string, unknown>;
  status: string;
  error: string | null;
  reason: string | null;
  requested_by: string | null;
  approved_by: string | null;
  idempotency_key: string;
  before: unknown;
  after: unknown;
  requested_at: Date;
  applied_at: Date | null;
  reverted_at: Date | null;
  reverted_by: string | null;
  reverts_action_id: string | null;
  requested_by_name?: string | null;
  approved_by_name?: string | null;
  experiment_status?: string;
}

interface ReviewRow {
  id: string;
  experiment_id: string | null;
  revision: number;
  simulated: boolean;
  result: ReviewResult;
}

interface ExpRow {
  id: string;
  campaign_id: string;
  step_id: string;
  status: string;
  kind: string;
  unit: string;
  primary_metric: string;
  secondary_metric: string;
  offer_ref: string | null;
}

interface VariantRow {
  id: string;
  label: string;
  subject: string;
  status: string;
  is_control: boolean;
  template_id: string | null;
  template_version: number;
}

/** Drafts one review may create (3 per click): stops runaway AI spend. */
export const MAX_DRAFTS_PER_REVIEW = 9;

const ACTION_SELECT = `
  ra.id, ra.review_id, ra.experiment_id, ra.revision, ra.action_id, ra.type,
  ra.payload, ra.status, ra.error, ra.reason, ra.requested_by, ra.approved_by,
  ra.idempotency_key, ra.before, ra.after, ra.requested_at, ra.applied_at,
  ra.reverted_at, ra.reverted_by, ra.reverts_action_id,
  ru.name AS requested_by_name, au.name AS approved_by_name,
  e.status AS experiment_status
  FROM review_actions ra
  JOIN experiments e ON e.id = ra.experiment_id
  LEFT JOIN users ru ON ru.id = ra.requested_by
  LEFT JOIN users au ON au.id = ra.approved_by`;

function assertManager(user: AuthUser): void {
  // The controller has @Roles too; this is the second, server-side check that
  // every approval repeats (background callers go through here as well).
  if (user.role !== 'admin' && user.role !== 'manager') {
    throw new ForbiddenException(
      'Only managers and admins can approve actions',
    );
  }
}

const conflict = (error: string, message: string): never => {
  throw new ConflictException({ statusCode: 409, error, message });
};

@Injectable()
export class ReviewActionsService {
  private readonly logger = new Logger(ReviewActionsService.name);

  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    private readonly experiments: ExperimentsService,
    @Inject(CHALLENGER_DRAFTER) private readonly drafter: ChallengerDrafter,
  ) {}

  // ── views ──────────────────────────────────────────────────────────────

  private view(row: ActionRow, replayed = false): ActionView {
    const who = (id: string | null, name?: string | null) =>
      id ? { id, name: name ?? 'Unknown' } : null;
    return {
      id: row.id,
      reviewId: row.review_id,
      experimentId: row.experiment_id,
      revision: row.revision,
      actionId: row.action_id,
      type: row.type,
      status: row.status,
      payload: row.payload,
      reason: row.reason,
      requestedBy: who(row.requested_by, row.requested_by_name),
      approvedBy: who(row.approved_by, row.approved_by_name),
      before: row.before,
      after: row.after,
      requestedAt: row.requested_at,
      appliedAt: row.applied_at,
      revertedAt: row.reverted_at,
      revertsActionId: row.reverts_action_id,
      canRevert:
        row.status === 'applied' &&
        (row.type === 'pause_variant' || row.type === 'resume_variant') &&
        row.experiment_status === 'running',
      replayed,
    };
  }

  private async loadAction(
    c: PoolClient,
    id: string,
  ): Promise<ActionRow | null> {
    const r = await c.query<ActionRow>(
      `SELECT ${ACTION_SELECT} WHERE ra.id = $1`,
      [id],
    );
    return r.rows[0] ?? null;
  }

  private async loadByKey(
    c: PoolClient,
    orgId: string,
    key: string,
  ): Promise<ActionRow | null> {
    const r = await c.query<ActionRow>(
      `SELECT ${ACTION_SELECT} WHERE ra.org_id = $1 AND ra.idempotency_key = $2`,
      [orgId, key],
    );
    return r.rows[0] ?? null;
  }

  // ── shared pieces ──────────────────────────────────────────────────────

  /** Serialises everything that changes this experiment (pause, resume, approve). */
  private async lockExperiment(
    c: PoolClient,
    experimentId: string,
  ): Promise<ExpRow> {
    const r = await c.query<ExpRow>(
      `SELECT id, campaign_id, step_id, status, kind, unit, primary_metric,
              secondary_metric, offer_ref
         FROM experiments WHERE id = $1 FOR UPDATE`,
      [experimentId],
    );
    if (!r.rows[0]) throw new NotFoundException('Experiment not found');
    return r.rows[0];
  }

  private async variantsOf(
    c: PoolClient,
    experimentId: string,
  ): Promise<VariantRow[]> {
    const r = await c.query<VariantRow>(
      `SELECT id, label, subject, status, is_control, template_id, template_version
         FROM experiment_variants WHERE experiment_id = $1
        ORDER BY created_at ASC, id ASC`,
      [experimentId],
    );
    return r.rows;
  }

  private async assignedTo(
    c: PoolClient,
    experimentId: string,
    variantId: string,
  ): Promise<number> {
    const r = await c.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM experiment_assignments
        WHERE experiment_id = $1 AND variant_id = $2`,
      [experimentId, variantId],
    );
    return r.rows[0].n;
  }

  /** Replays a stored result for a repeated key, or refuses a reused one. */
  private async replayOrNull(
    c: PoolClient,
    orgId: string,
    key: string,
    same: (row: ActionRow) => boolean,
  ): Promise<ActionView | null> {
    const existing = await this.loadByKey(c, orgId, key);
    if (!existing) return null;
    if (!same(existing)) {
      return conflict(
        'idempotency_key_reused',
        'This request key was already used for a different action.',
      );
    }
    return this.view(existing, true);
  }

  private async pauseVariantInTx(
    c: PoolClient,
    exp: ExpRow,
    variantId: string,
    userId: string,
    reason: string,
  ): Promise<{
    before: unknown;
    after: unknown;
    payload: Record<string, unknown>;
  }> {
    const variants = await this.variantsOf(c, exp.id);
    const v = variants.find((x) => x.id === variantId);
    if (!v) {
      throw new BadRequestException('That version is not part of this test');
    }
    if (v.status !== 'active') {
      return conflict(
        'variant_not_active',
        `Version ${v.label} is not active, so there is nothing to pause.`,
      );
    }
    const activeNow = variants.filter((x) => x.status === 'active').length;
    if (activeNow < 2) {
      return conflict(
        'last_active_variant',
        'At least one version must stay active. To stop the whole test, stop it from the campaign.',
      );
    }
    const keeping = await this.assignedTo(c, exp.id, v.id);
    await c.query(
      `UPDATE experiment_variants
          SET status = 'paused', paused_by = $2, paused_at = now(), pause_reason = $3
        WHERE id = $1`,
      [v.id, userId, reason],
    );
    return {
      before: {
        variantId: v.id,
        label: v.label,
        status: 'active',
        activeVersions: activeNow,
      },
      after: {
        variantId: v.id,
        label: v.label,
        status: 'paused',
        reason,
        activeVersions: activeNow - 1,
        companiesKeepingVersion: keeping,
      },
      payload: { variantId: v.id, variantLabel: v.label },
    };
  }

  private async resumeVariantInTx(
    c: PoolClient,
    exp: ExpRow,
    variantId: string,
    userId: string,
  ): Promise<{
    before: unknown;
    after: unknown;
    payload: Record<string, unknown>;
  }> {
    const variants = await this.variantsOf(c, exp.id);
    const v = variants.find((x) => x.id === variantId);
    if (!v) {
      throw new BadRequestException('That version is not part of this test');
    }
    if (v.status !== 'paused') {
      return conflict(
        'variant_not_paused',
        `Version ${v.label} is not paused.`,
      );
    }
    const activeNow = variants.filter((x) => x.status === 'active').length;
    await c.query(
      `UPDATE experiment_variants
          SET status = 'active', resumed_by = $2, resumed_at = now()
        WHERE id = $1`,
      [v.id, userId],
    );
    return {
      before: {
        variantId: v.id,
        label: v.label,
        status: 'paused',
        activeVersions: activeNow,
      },
      after: {
        variantId: v.id,
        label: v.label,
        status: 'active',
        activeVersions: activeNow + 1,
      },
      payload: { variantId: v.id, variantLabel: v.label },
    };
  }

  private async insertAction(
    c: PoolClient,
    p: {
      orgId: string;
      reviewId: string;
      experimentId: string;
      revision: number;
      actionId: string;
      type: StoredActionType;
      payload: Record<string, unknown>;
      reason: string | null;
      userId: string;
      idempotencyKey: string;
      before: unknown;
      after: unknown;
      revertsActionId?: string | null;
    },
  ): Promise<ActionRow> {
    try {
      const r = await c.query<{ id: string }>(
        `INSERT INTO review_actions
           (org_id, review_id, experiment_id, revision, action_id, type, payload,
            status, reason, requested_by, approved_by, idempotency_key,
            before, after, applied_at, reverts_action_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,'applied',$8,$9,$9,$10,
                 $11::jsonb,$12::jsonb, now(), $13)
         RETURNING id`,
        [
          p.orgId,
          p.reviewId,
          p.experimentId,
          p.revision,
          p.actionId,
          p.type,
          JSON.stringify(p.payload),
          p.reason,
          p.userId,
          p.idempotencyKey,
          JSON.stringify(p.before ?? null),
          JSON.stringify(p.after ?? null),
          p.revertsActionId ?? null,
        ],
      );
      return (await this.loadAction(c, r.rows[0].id))!;
    } catch (e) {
      if ((e as { code?: string }).code === '23505') {
        return conflict(
          'already_applied',
          'This action was already applied. Refresh and look at the history.',
        );
      }
      throw e;
    }
  }

  // ── approve ────────────────────────────────────────────────────────────

  async approve(
    orgId: string,
    user: AuthUser,
    reviewId: string,
    actionId: string,
    dto: {
      revision: number;
      idempotencyKey: string;
      reason?: string;
      draftId?: string;
    },
  ): Promise<ActionView> {
    assertManager(user);
    return withOrgContext(this.pool, orgId, async (c) => {
      const rv = await c.query<ReviewRow>(
        `SELECT id, experiment_id, revision, simulated, result
           FROM reviews WHERE id = $1`,
        [reviewId],
      );
      const review = rv.rows[0];
      if (!review) throw new NotFoundException('Review not found');
      if (review.simulated || !review.experiment_id) {
        throw new BadRequestException({
          statusCode: 400,
          error: 'simulated_review',
          message: 'Simulation: nothing changes.',
        });
      }

      // Lock first: parallel approvals of one experiment queue up here, and a
      // parallel repeat of the same key then finds the first one's row.
      const exp = await this.lockExperiment(c, review.experiment_id);

      const replay = await this.replayOrNull(
        c,
        orgId,
        dto.idempotencyKey,
        (row) => row.review_id === reviewId && row.action_id === actionId,
      );
      if (replay) return replay;

      const latest = await c.query<{ revision: number }>(
        `SELECT max(revision)::int AS revision FROM reviews
          WHERE experiment_id = $1 AND NOT simulated`,
        [exp.id],
      );
      const latestRevision = latest.rows[0]?.revision ?? 0;
      if (
        dto.revision !== review.revision ||
        review.revision !== latestRevision
      ) {
        return conflict(
          'stale_review',
          'Results changed, please re-check the latest review before approving.',
        );
      }

      const allowed: AllowedAction | undefined = (
        review.result.allowedActions ?? []
      ).find((a) => a.actionId === actionId);
      if (!allowed) {
        throw new BadRequestException({
          statusCode: 400,
          error: 'action_not_allowed',
          message: 'This action is not offered by this review.',
        });
      }
      if (exp.status !== 'running') {
        return conflict(
          'experiment_not_running',
          'This test is no longer running, so there is nothing to change.',
        );
      }
      const done = await c.query(
        `SELECT 1 FROM review_actions
          WHERE review_id = $1 AND action_id = $2
            AND status = 'applied' AND reverts_action_id IS NULL`,
        [reviewId, actionId],
      );
      if ((done.rowCount ?? 0) > 0) {
        return conflict(
          'already_applied',
          'This action was already applied. Refresh and look at the history.',
        );
      }

      let type: StoredActionType;
      let applied: {
        before: unknown;
        after: unknown;
        payload: Record<string, unknown>;
      };
      switch (allowed.type) {
        case 'keep_testing':
          type = 'keep_testing';
          applied = {
            before: { experimentStatus: exp.status },
            after: { experimentStatus: exp.status },
            payload: {},
          };
          break;
        case 'pause_variant':
          type = 'pause_variant';
          applied = await this.pauseVariantInTx(
            c,
            exp,
            allowed.variantId ?? '',
            user.userId,
            dto.reason?.trim() ||
              `Paused after review revision ${review.revision}`,
          );
          break;
        case 'draft_challenger':
          type = 'approve_challenger';
          applied = await this.approveChallengerInTx(
            c,
            orgId,
            user,
            exp,
            review,
            dto.draftId,
          );
          break;
        default:
          throw new BadRequestException({
            statusCode: 400,
            error: 'action_not_supported',
            message: 'This action is not available yet.',
          });
      }

      const row = await this.insertAction(c, {
        orgId,
        reviewId,
        experimentId: exp.id,
        revision: review.revision,
        actionId,
        type,
        payload: applied.payload,
        reason: dto.reason?.trim() || null,
        userId: user.userId,
        idempotencyKey: dto.idempotencyKey,
        before: applied.before,
        after: applied.after,
      });
      this.logger.log(
        `review action ${type} applied (experiment ${exp.id}, revision ${review.revision})`,
      );
      return this.view(row);
    });
  }

  /**
   * Approving a challenger CLOSES the current test and starts a NEW one on the
   * same step (an edit to copy is a new version and a new test, never a change
   * to a running one). The new control is the current winner, or the old
   * control when nothing won. Companies already assigned in the old test are
   * not eligible for the new one: the send path keeps them on their old
   * version (see send.service.ts).
   */
  private async approveChallengerInTx(
    c: PoolClient,
    orgId: string,
    user: AuthUser,
    exp: ExpRow,
    review: ReviewRow,
    draftId: string | undefined,
  ): Promise<{
    before: unknown;
    after: unknown;
    payload: Record<string, unknown>;
  }> {
    if (!draftId) {
      throw new BadRequestException({
        statusCode: 400,
        error: 'draft_required',
        message: 'Pick a drafted challenger and preview it first.',
      });
    }
    const dr = await c.query<{ id: string; subject: string; source: string }>(
      `SELECT id, subject, source FROM challenger_drafts
        WHERE id = $1 AND review_id = $2`,
      [draftId, review.id],
    );
    if (!dr.rows[0]) {
      throw new NotFoundException('That draft does not belong to this review');
    }
    const challengerSubject = cleanSubject(dr.rows[0].subject);
    if (!challengerSubject) {
      throw new BadRequestException('That draft subject is not valid');
    }

    const variants = await this.variantsOf(c, exp.id);
    const winnerId = review.result.winnerVariantId;
    const keep =
      variants.find((v) => v.id === winnerId) ??
      variants.find((v) => v.is_control) ??
      variants[0];
    if (!keep) throw new BadRequestException('This test has no versions');
    if (
      variants.some(
        (v) =>
          v.subject.trim().toLowerCase() === challengerSubject.toLowerCase(),
      )
    ) {
      throw new BadRequestException({
        statusCode: 400,
        error: 'same_subject',
        message: 'The challenger must differ from the versions already tested.',
      });
    }

    // 1. close the old test (before the new one: one running test per step)
    const decision = {
      decision: review.result.decision,
      winnerVariantId: winnerId ?? null,
      keptVariantId: keep.id,
      reviewId: review.id,
      revision: review.revision,
      closedBy: user.userId,
      reason: 'challenger_approved',
    };
    await c.query(
      `UPDATE experiments
          SET status = 'decided', decided_at = now(), decision = $2::jsonb,
              updated_at = now()
        WHERE id = $1`,
      [exp.id, JSON.stringify(decision)],
    );

    // 2. new test on the same step, fresh defaults, linked to the old one
    const baseline = await this.experiments.defaultBaselineRate(c);
    const created = await c.query<{ id: string }>(
      `INSERT INTO experiments
         (org_id, campaign_id, step_id, kind, status, unit, primary_metric,
          secondary_metric, baseline_rate, min_lift_pp, response_window_days,
          guardrails, allocation, policy_version, offer_ref, created_by,
          started_at, previous_experiment_id)
       VALUES ($1,$2,$3,$4,'running',$5,$6,$7,$8,2,14,$9::jsonb,
               '{"weights":[0.5,0.5]}'::jsonb,'v1',$10,$11, now(), $12)
       RETURNING id`,
      [
        orgId,
        exp.campaign_id,
        exp.step_id,
        exp.kind,
        exp.unit,
        exp.primary_metric,
        exp.secondary_metric,
        baseline,
        JSON.stringify(DEFAULT_GUARDRAILS),
        exp.offer_ref,
        user.userId,
        exp.id,
      ],
    );
    const newId = created.rows[0].id;

    // 3. two versions: the kept one (control) and the approved challenger
    await c.query(
      `INSERT INTO experiment_variants
         (org_id, experiment_id, label, subject, template_id, template_version,
          is_control, status, created_by, approved_by, approved_at)
       VALUES ($1,$2,'A',$3,$4,$5,true,'active',$6,$6,now())`,
      [
        orgId,
        newId,
        keep.subject,
        keep.template_id,
        keep.template_version,
        user.userId,
      ],
    );
    await c.query(
      `INSERT INTO experiment_variants
         (org_id, experiment_id, label, subject, template_id, template_version,
          is_control, status, created_by, approved_by, approved_at)
       VALUES ($1,$2,'B',$3,$4,$5,false,'active',$6,$6,now())`,
      [
        orgId,
        newId,
        challengerSubject,
        keep.template_id,
        keep.template_version,
        user.userId,
      ],
    );

    return {
      before: { experimentId: exp.id, status: 'running' },
      after: {
        experimentId: exp.id,
        status: 'decided',
        newExperimentId: newId,
        control: keep.subject,
        challenger: challengerSubject,
      },
      payload: {
        draftId,
        newExperimentId: newId,
        challengerSubject,
        keptVariantId: keep.id,
      },
    };
  }

  // ── resume ─────────────────────────────────────────────────────────────

  async resume(
    orgId: string,
    user: AuthUser,
    experimentId: string,
    variantId: string,
    dto: { revision: number; idempotencyKey: string; reason?: string },
  ): Promise<ActionView> {
    assertManager(user);
    const actionId = `resume:${variantId}`;
    return withOrgContext(this.pool, orgId, async (c) => {
      const exp = await this.lockExperiment(c, experimentId);
      const replay = await this.replayOrNull(
        c,
        orgId,
        dto.idempotencyKey,
        (row) =>
          row.experiment_id === experimentId && row.action_id === actionId,
      );
      if (replay) return replay;

      const latest = await c.query<{ id: string; revision: number }>(
        `SELECT id, revision FROM reviews
          WHERE experiment_id = $1 AND NOT simulated
          ORDER BY revision DESC LIMIT 1`,
        [exp.id],
      );
      const review = latest.rows[0];
      if (!review) {
        return conflict(
          'no_review',
          'Open the Review tab first so there is a review to act on.',
        );
      }
      if (dto.revision !== review.revision) {
        return conflict(
          'stale_review',
          'Results changed, please re-check the latest review before approving.',
        );
      }
      if (exp.status !== 'running') {
        return conflict(
          'experiment_not_running',
          'This test is no longer running, so there is nothing to change.',
        );
      }

      const applied = await this.resumeVariantInTx(
        c,
        exp,
        variantId,
        user.userId,
      );

      // The pause this resume undoes is closed in the history, so the same
      // review can pause that version again later.
      const pause = await c.query<{ id: string }>(
        `SELECT id FROM review_actions
          WHERE experiment_id = $1 AND type = 'pause_variant'
            AND status = 'applied' AND payload->>'variantId' = $2
          ORDER BY requested_at DESC LIMIT 1`,
        [exp.id, variantId],
      );
      const pauseId = pause.rows[0]?.id ?? null;
      if (pauseId) {
        await c.query(
          `UPDATE review_actions
              SET status = 'reverted', reverted_at = now(), reverted_by = $2
            WHERE id = $1`,
          [pauseId, user.userId],
        );
      }

      const row = await this.insertAction(c, {
        orgId,
        reviewId: review.id,
        experimentId: exp.id,
        revision: review.revision,
        actionId,
        type: 'resume_variant',
        payload: applied.payload,
        reason: dto.reason?.trim() || null,
        userId: user.userId,
        idempotencyKey: dto.idempotencyKey,
        before: applied.before,
        after: applied.after,
        revertsActionId: pauseId,
      });
      return this.view(row);
    });
  }

  // ── revert ─────────────────────────────────────────────────────────────

  async revert(
    orgId: string,
    user: AuthUser,
    id: string,
    dto: { idempotencyKey: string; reason: string },
  ): Promise<ActionView> {
    assertManager(user);
    return withOrgContext(this.pool, orgId, async (c) => {
      const orig = await this.loadAction(c, id);
      if (!orig) throw new NotFoundException('Action not found');
      const exp = await this.lockExperiment(c, orig.experiment_id);

      const replay = await this.replayOrNull(
        c,
        orgId,
        dto.idempotencyKey,
        (row) => row.reverts_action_id === orig.id,
      );
      if (replay) return replay;

      if (orig.status === 'reverted') {
        return conflict(
          'already_reverted',
          'This action was already reverted.',
        );
      }
      if (orig.status !== 'applied') {
        return conflict(
          'not_applied',
          'Only an applied action can be reverted.',
        );
      }
      if (orig.type !== 'pause_variant' && orig.type !== 'resume_variant') {
        throw new BadRequestException({
          statusCode: 400,
          error: 'not_revertible',
          message:
            orig.type === 'approve_challenger'
              ? 'An approved challenger cannot be undone. Stop the new test from the campaign if you need to.'
              : 'There is nothing to undo for this action.',
        });
      }
      if (exp.status !== 'running') {
        return conflict(
          'experiment_not_running',
          'This test is no longer running, so there is nothing to change.',
        );
      }

      const rawVariantId = orig.payload?.variantId;
      const variantId = typeof rawVariantId === 'string' ? rawVariantId : '';
      const reason = dto.reason.trim();
      let inverse: StoredActionType;
      let applied: {
        before: unknown;
        after: unknown;
        payload: Record<string, unknown>;
      };
      if (orig.type === 'pause_variant') {
        inverse = 'resume_variant';
        applied = await this.resumeVariantInTx(c, exp, variantId, user.userId);
      } else {
        inverse = 'pause_variant';
        applied = await this.pauseVariantInTx(
          c,
          exp,
          variantId,
          user.userId,
          reason,
        );
      }
      await c.query(
        `UPDATE review_actions
            SET status = 'reverted', reverted_at = now(), reverted_by = $2
          WHERE id = $1`,
        [orig.id, user.userId],
      );
      const row = await this.insertAction(c, {
        orgId,
        reviewId: orig.review_id,
        experimentId: exp.id,
        revision: orig.revision,
        actionId: `revert:${orig.id}`,
        type: inverse,
        payload: { ...applied.payload, revertOf: orig.id },
        reason,
        userId: user.userId,
        idempotencyKey: dto.idempotencyKey,
        before: applied.before,
        after: applied.after,
        revertsActionId: orig.id,
      });
      return this.view(row);
    });
  }

  // ── history ────────────────────────────────────────────────────────────

  async history(orgId: string, campaignId: string): Promise<ActionView[]> {
    return withOrgContext(this.pool, orgId, async (c) => {
      const camp = await c.query(`SELECT 1 FROM campaigns WHERE id = $1`, [
        campaignId,
      ]);
      if (camp.rowCount === 0)
        throw new NotFoundException('Campaign not found');
      const r = await c.query<ActionRow>(
        `SELECT ${ACTION_SELECT}
          WHERE e.campaign_id = $1
          ORDER BY ra.requested_at DESC, ra.id DESC
          LIMIT 200`,
        [campaignId],
      );
      return r.rows.map((row) => this.view(row));
    });
  }

  // ── challenger drafts ──────────────────────────────────────────────────

  private async draftContext(c: PoolClient, reviewId: string) {
    const rv = await c.query<ReviewRow>(
      `SELECT id, experiment_id, revision, simulated, result
         FROM reviews WHERE id = $1`,
      [reviewId],
    );
    const review = rv.rows[0];
    if (!review) throw new NotFoundException('Review not found');
    if (review.simulated || !review.experiment_id) {
      throw new BadRequestException({
        statusCode: 400,
        error: 'simulated_review',
        message: 'Simulation: nothing changes.',
      });
    }
    return { review, experimentId: review.experiment_id };
  }

  async listDrafts(orgId: string, reviewId: string): Promise<DraftView[]> {
    return withOrgContext(this.pool, orgId, async (c) => {
      const { review } = await this.draftContext(c, reviewId);
      const r = await c.query<{
        id: string;
        subject: string;
        source: string;
        created_at: Date;
      }>(
        `SELECT id, subject, source, created_at FROM challenger_drafts
          WHERE review_id = $1 ORDER BY created_at DESC, id DESC`,
        [review.id],
      );
      return r.rows.map((d) => ({
        id: d.id,
        subject: d.subject,
        source: d.source,
        createdAt: d.created_at,
      }));
    });
  }

  async createDrafts(
    orgId: string,
    user: AuthUser,
    reviewId: string,
  ): Promise<{ actionId: string; drafts: DraftView[] }> {
    assertManager(user);
    // Phase 1: read what the drafter needs (no lead data: subjects + offer only).
    const ctx = await withOrgContext(this.pool, orgId, async (c) => {
      const { review, experimentId } = await this.draftContext(c, reviewId);
      const allowed = (review.result.allowedActions ?? []).find(
        (a) => a.type === 'draft_challenger',
      );
      if (!allowed) {
        throw new BadRequestException({
          statusCode: 400,
          error: 'draft_not_allowed',
          message: 'This review does not offer a challenger yet.',
        });
      }
      const count = await c.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM challenger_drafts WHERE review_id = $1`,
        [review.id],
      );
      if (count.rows[0].n >= MAX_DRAFTS_PER_REVIEW) {
        throw new HttpException(
          {
            error: 'draft_limit',
            message: 'Enough drafts for this review. Pick one of them.',
          },
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
      const variants = await this.variantsOf(c, experimentId);
      const keep =
        variants.find((v) => v.id === review.result.winnerVariantId) ??
        variants.find((v) => v.is_control) ??
        variants[0];
      const offer = await c.query<{ name: string; description: string | null }>(
        `SELECT o.name, o.description FROM experiments e
           JOIN offers o ON o.id = e.offer_ref WHERE e.id = $1`,
        [experimentId],
      );
      // the workspace knowledge base (text only), for the Copywriter agent
      const kbRow = await c.query<Record<string, string | null>>(
        `SELECT description, audience, offer, pain_points, usps
           FROM org_knowledge LIMIT 1`,
      );
      const kb = Object.entries(kbRow.rows[0] ?? {})
        .filter(([, v]) => typeof v === 'string' && v.trim())
        .map(([k, v]) => `${k.replace('_', ' ')}: ${v}`)
        .join(String.fromCharCode(10));
      return {
        experimentId,
        actionId: allowed.actionId,
        kb,
        baseSubject: keep?.subject ?? '',
        avoid: variants.map((v) => v.subject),
        offerName: offer.rows[0]?.name ?? null,
        offerDescription: offer.rows[0]?.description ?? null,
      };
    });

    // Phase 2: ask the drafter outside any transaction (it may call an AI).
    const candidates = await this.drafter.draft({
      orgId,
      baseSubject: ctx.baseSubject,
      avoid: ctx.avoid,
      offerName: ctx.offerName,
      offerDescription: ctx.offerDescription,
      kb: ctx.kb,
    });

    // Phase 3: store them (re-reads the review so a deleted one is a 404).
    const drafts = await withOrgContext(this.pool, orgId, async (c) => {
      await this.draftContext(c, reviewId);
      const out: DraftView[] = [];
      for (const cand of candidates) {
        const r = await c.query<{ id: string; created_at: Date }>(
          `INSERT INTO challenger_drafts
             (org_id, review_id, experiment_id, subject, source, created_by)
           VALUES ($1,$2,$3,$4,$5,$6) RETURNING id, created_at`,
          [
            orgId,
            reviewId,
            ctx.experimentId,
            cand.subject,
            cand.source,
            user.userId,
          ],
        );
        out.push({
          id: r.rows[0].id,
          subject: cand.subject,
          source: cand.source,
          createdAt: r.rows[0].created_at,
        });
      }
      return out;
    });
    return { actionId: ctx.actionId, drafts };
  }
}
