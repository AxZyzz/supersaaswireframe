import { createHash } from 'crypto';
import {
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { Pool } from 'pg';
import {
  type ExplainOutcome,
  ReviewExplainerService,
} from '../agents/review-explainer.service';
import { PG_POOL } from '../db/db.module';
import { withOrgContext } from '../db/tenant-context';
import {
  decide,
  explain,
  type Explanation,
  type ReviewInput,
  type ReviewResult,
} from './policy';
import type { Slice } from './review-aggregate';
import { type ExperimentMeta, ReviewDataService } from './review-data.service';
import { type ScenarioId, simulate } from './simulation';

/** What the API returns for one review revision. */
export interface ReviewView {
  id: string;
  experimentId: string | null;
  revision: number;
  simulated: boolean;
  scenario: string | null;
  computedAt: Date;
  policyVersion: string;
  explanationSource: string;
  explanation: Explanation;
  /** The decision, gates, per-arm numbers, findings and audience slices. */
  result: ReviewResult & { slices: Slice[] };
  /** What the policy was given: every number on screen traces back to this. */
  inputs: ReviewInput;
  /** The plan (offer, window, decision date). null for simulations. */
  experiment: ExperimentMeta | null;
  /** Extra plain-words context (simulations only). */
  note: string | null;
}

interface ReviewRow {
  id: string;
  experiment_id: string | null;
  revision: number;
  simulated: boolean;
  scenario: string | null;
  computed_at: Date;
  policy_version: string;
  explanation_source: string;
  explanation: Explanation;
  result: ReviewResult & { slices: Slice[] };
  inputs: ReviewInput;
  inputs_hash: string;
}

const COLS = `id, experiment_id, revision, simulated, scenario, computed_at, policy_version,
  explanation_source, explanation, result, inputs, inputs_hash`;

/**
 * The hash that decides whether a refresh is a NEW revision. It covers every
 * number the policy sees but not the clock itself; time still matters when it
 * changes an input (a window closing moves windowClosed) or crosses the
 * decision date (kept as a boolean).
 */
export function inputsHash(input: ReviewInput): string {
  const stable = {
    policy: input.policyVersion,
    decisionDate: input.decisionDate,
    decisionReached:
      input.decisionDate === null ? true : input.now >= input.decisionDate,
    earliestFullRead: input.earliestFullRead,
    baselineRate: input.baselineRate,
    minLiftPp: input.minLiftPp,
    targetNPerArm: input.targetNPerArm,
    guardrails: input.guardrails,
    coverageGate: input.coverageGate,
    outcomeCoverage: input.outcomeCoverage,
    arms: input.arms,
    flags: input.flags,
  };
  return createHash('sha256').update(JSON.stringify(stable)).digest('hex');
}

/** Refresh is limited to once per 30 s per campaign (per API instance). */
export const REFRESH_COOLDOWN_MS = 30_000;

@Injectable()
export class ReviewService {
  /** Mutable so tests can turn the limit off. */
  refreshCooldownMs = REFRESH_COOLDOWN_MS;
  private readonly lastRefresh = new Map<string, number>();

  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    private readonly data: ReviewDataService,
    // T09: AI explanation (REVIEW_EXPLAINER). Absent/template = the T04 text.
    @Optional() private readonly explainer?: ReviewExplainerService,
  ) {}

  private view(
    row: ReviewRow,
    experiment: ExperimentMeta | null,
    note: string | null = null,
  ): ReviewView {
    return {
      id: row.id,
      experimentId: row.experiment_id,
      revision: row.revision,
      simulated: row.simulated,
      scenario: row.scenario,
      computedAt: row.computed_at,
      policyVersion: row.policy_version,
      explanationSource: row.explanation_source,
      explanation: row.explanation,
      result: row.result,
      inputs: row.inputs,
      experiment,
      note,
    };
  }

  /** The experiment this campaign's Review is about: running first, else the newest. */
  private async experimentOf(
    orgId: string,
    campaignId: string,
  ): Promise<string> {
    const r = await withOrgContext(this.pool, orgId, async (c) => {
      const camp = await c.query(`SELECT 1 FROM campaigns WHERE id = $1`, [
        campaignId,
      ]);
      if (camp.rowCount === 0) {
        throw new NotFoundException('Campaign not found');
      }
      return c.query<{ id: string }>(
        `SELECT id FROM experiments
          WHERE campaign_id = $1 AND status <> 'draft'
          ORDER BY (status = 'running') DESC, created_at DESC LIMIT 1`,
        [campaignId],
      );
    });
    if (!r.rows[0]) {
      throw new NotFoundException({
        error: 'no_experiment',
        message: 'This campaign has no A/B test to review yet.',
      });
    }
    return r.rows[0].id;
  }

  private latestRow(orgId: string, experimentId: string) {
    return withOrgContext(
      this.pool,
      orgId,
      async (c) =>
        (
          await c.query<ReviewRow>(
            `SELECT ${COLS} FROM reviews
              WHERE experiment_id = $1 AND NOT simulated
              ORDER BY revision DESC LIMIT 1`,
            [experimentId],
          )
        ).rows[0] ?? null,
    );
  }

  /** Latest stored review; computed once if this experiment has none yet. */
  async latestForCampaign(
    orgId: string,
    userId: string | null,
    campaignId: string,
  ): Promise<ReviewView> {
    const experimentId = await this.experimentOf(orgId, campaignId);
    const row =
      (await this.latestRow(orgId, experimentId)) ??
      (await this.compute(orgId, userId, experimentId)).row;
    return this.view(row, await this.data.meta(orgId, experimentId));
  }

  /**
   * Recompute now. Unchanged inputs return the latest revision untouched; any
   * change in the numbers saves revision N+1.
   */
  async refresh(
    orgId: string,
    userId: string,
    campaignId: string,
  ): Promise<ReviewView & { changed: boolean }> {
    const experimentId = await this.experimentOf(orgId, campaignId);
    const key = `${orgId}:${campaignId}`;
    const last = this.lastRefresh.get(key);
    if (last !== undefined && Date.now() - last < this.refreshCooldownMs) {
      throw new HttpException(
        {
          error: 'refresh_limited',
          message: 'Refresh is limited to once every 30 seconds.',
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    this.lastRefresh.set(key, Date.now());
    const { row, changed } = await this.compute(orgId, userId, experimentId);
    return {
      ...this.view(row, await this.data.meta(orgId, experimentId)),
      changed,
    };
  }

  private async compute(
    orgId: string,
    userId: string | null,
    experimentId: string,
  ): Promise<{ row: ReviewRow; changed: boolean }> {
    const src = await this.data.load(orgId, experimentId, new Date());
    const hash = inputsHash(src.input);
    const result = {
      ...decide(src.input),
      slices: src.slices,
    };
    const template = explain(result);
    // explained once, and only when something changed (never on an unchanged refresh)
    let explained: ExplainOutcome | null = null;

    for (let attempt = 0; attempt < 2; attempt++) {
      const latest = await this.latestRow(orgId, experimentId);
      if (latest && latest.inputs_hash === hash) {
        return { row: latest, changed: false };
      }
      if (!explained) {
        explained = this.explainer
          ? await this.explainer.explain(
              orgId,
              experimentId,
              (latest?.revision ?? 0) + 1,
              result,
            )
          : { explanation: template, source: 'template' };
      }
      const explanation = explained.explanation;
      const explanationSource = explained.source;
      try {
        const row = await withOrgContext(this.pool, orgId, async (c) => {
          const r = await c.query<ReviewRow>(
            `INSERT INTO reviews
               (org_id, experiment_id, revision, policy_version, simulated,
                inputs_hash, created_by, inputs, result, explanation,
                explanation_source)
             SELECT $1, $2, COALESCE(max(revision), 0) + 1, $3, false,
                    $4, $5, $6::jsonb, $7::jsonb, $8::jsonb, $9
               FROM reviews WHERE experiment_id = $2
             RETURNING ${COLS}`,
            [
              orgId,
              experimentId,
              src.input.policyVersion,
              hash,
              userId,
              JSON.stringify(src.input),
              JSON.stringify(result),
              JSON.stringify(explanation),
              explanationSource,
            ],
          );
          return r.rows[0];
        });
        return { row, changed: true };
      } catch (e) {
        // two refreshes raced for the same revision number: read again
        if ((e as { code?: string }).code !== '23505') throw e;
      }
    }
    // the racing writer saved identical inputs; its row is the answer
    return {
      row: await this.latestRow(orgId, experimentId),
      changed: false,
    };
  }

  /** One specific revision (audit links). Simulated reviews are fetchable by id too. */
  async get(orgId: string, id: string): Promise<ReviewView> {
    const row = await withOrgContext(
      this.pool,
      orgId,
      async (c) =>
        (
          await c.query<ReviewRow>(
            `SELECT ${COLS} FROM reviews WHERE id = $1`,
            [id],
          )
        ).rows[0],
    );
    if (!row) throw new NotFoundException('Review not found');
    const meta = row.experiment_id
      ? await this.data.meta(orgId, row.experiment_id)
      : null;
    return this.view(row, meta);
  }

  /**
   * "Try simulation": the same policy on generated data, saved as
   * simulated = true with no experiment. It never touches real tables and no
   * real-results query ever returns it.
   */
  async simulate(
    orgId: string,
    userId: string,
    scenario: ScenarioId,
  ): Promise<ReviewView> {
    const sim = simulate(scenario);
    const result = { ...decide(sim.input), slices: sim.slices };
    const explanation = explain(result);
    const row = await withOrgContext(this.pool, orgId, async (c) => {
      const r = await c.query<ReviewRow>(
        `INSERT INTO reviews
           (org_id, experiment_id, revision, policy_version, simulated, scenario,
            inputs_hash, created_by, inputs, result, explanation, explanation_source)
         VALUES ($1, NULL, 1, $2, true, $3, $4, $5, $6::jsonb, $7::jsonb, $8::jsonb, 'template')
         RETURNING ${COLS}`,
        [
          orgId,
          sim.input.policyVersion,
          scenario,
          inputsHash(sim.input),
          userId,
          JSON.stringify(sim.input),
          JSON.stringify(result),
          JSON.stringify(explanation),
        ],
      );
      return r.rows[0];
    });
    return this.view(row, null, sim.note);
  }
}
