import { Inject, Injectable, Logger } from '@nestjs/common';
import { Pool } from 'pg';
import { PG_POOL } from '../db/db.module';
import { withOrgContext } from '../db/tenant-context';
import { isoWeek } from '../loop-health/loop-health-logic';
import { ReviewService } from '../review/review.service';
import { SearchPreferencesService } from '../search-preferences/search-preferences.service';
import { withSpan } from '../tracing/spans';

export interface WeeklyReviewResult {
  period: string;
  /** Workspaces with a running experiment or an active preference. */
  workspaces: number;
  /** Workspaces refreshed by this call. */
  refreshed: number;
  /** Workspaces already done this ISO week (a retry, or another instance). */
  skipped: number;
  /** Workspaces that failed; they are retried by the next call. */
  failed: number;
  /** Reviews that got a new revision (the numbers had changed). */
  newRevisions: number;
}

const JOB = 'weekly_review';

/**
 * The weekly auto-review (T13): for every workspace with a running A/B test or
 * an active search preference, recompute the Review (a new revision when the
 * numbers moved) and the preference results. One workspace per ISO week, once:
 * the claim row in cron_runs makes a Cloud Scheduler retry, or two API
 * instances, harmless. A workspace that fails gives its claim back so the
 * next call tries it again, and never stops the others.
 */
@Injectable()
export class WeeklyReviewService {
  private readonly logger = new Logger(WeeklyReviewService.name);

  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    private readonly review: ReviewService,
    private readonly prefs: SearchPreferencesService,
  ) {}

  run(now = new Date()): Promise<WeeklyReviewResult> {
    return withSpan('weekly_review', async () => {
      const period = isoWeek(now);
      const orgs = await this.pool.query<{ org_id: string }>(
        `SELECT org_id FROM loop_workspaces()`,
      );
      const out: WeeklyReviewResult = {
        period,
        workspaces: orgs.rows.length,
        refreshed: 0,
        skipped: 0,
        failed: 0,
        newRevisions: 0,
      };
      for (const { org_id: orgId } of orgs.rows) {
        try {
          const done = await this.runOrg(orgId, period);
          if (done === null) out.skipped += 1;
          else {
            out.refreshed += 1;
            out.newRevisions += done;
          }
        } catch (e) {
          out.failed += 1;
          this.logger.error(
            JSON.stringify({
              event: 'weekly_review_failed',
              org_id: orgId,
              period,
              error: e instanceof Error ? e.message : String(e),
            }),
          );
        }
      }
      this.logger.log(JSON.stringify({ event: 'weekly_review', ...out }));
      return out;
    });
  }

  /** null = already done this week; otherwise how many reviews got a new revision. */
  private async runOrg(orgId: string, period: string): Promise<number | null> {
    const claimed = await withOrgContext(this.pool, orgId, async (c) => {
      const r = await c.query(
        `INSERT INTO cron_runs (org_id, job, period) VALUES ($1, $2, $3)
         ON CONFLICT (org_id, job, period) DO NOTHING RETURNING id`,
        [orgId, JOB, period],
      );
      return (r.rowCount ?? 0) > 0;
    });
    if (!claimed) return null;

    try {
      const ids = await withOrgContext(this.pool, orgId, async (c) => ({
        experiments: (
          await c.query<{ id: string }>(
            `SELECT id FROM experiments WHERE status = 'running' ORDER BY created_at`,
          )
        ).rows.map((r) => r.id),
        preferences: (
          await c.query<{ id: string }>(
            `SELECT id FROM search_preferences WHERE status = 'active'`,
          )
        ).rows.map((r) => r.id),
      }));

      let newRevisions = 0;
      const reviews: {
        experimentId: string;
        revision: number;
        changed: boolean;
      }[] = [];
      for (const experimentId of ids.experiments) {
        const r = await this.review.refreshForExperiment(
          orgId,
          null,
          experimentId,
        );
        if (r.changed) newRevisions += 1;
        reviews.push({ experimentId, ...r });
      }
      const preferences: { id: string; state: string }[] = [];
      for (const id of ids.preferences) {
        const res = await this.prefs.results(orgId, id);
        preferences.push({ id, state: res.verdict.state });
      }
      await withOrgContext(this.pool, orgId, (c) =>
        c.query(
          `UPDATE cron_runs SET result = $4::jsonb, ran_at = now()
            WHERE org_id = $1 AND job = $2 AND period = $3`,
          [orgId, JOB, period, JSON.stringify({ reviews, preferences })],
        ),
      );
      return newRevisions;
    } catch (e) {
      // give the claim back: this workspace is tried again by the next call
      await withOrgContext(this.pool, orgId, (c) =>
        c.query(
          `DELETE FROM cron_runs WHERE org_id = $1 AND job = $2 AND period = $3`,
          [orgId, JOB, period],
        ),
      ).catch(() => undefined);
      throw e;
    }
  }
}
