import { Inject, Injectable, Logger } from '@nestjs/common';
import { Pool } from 'pg';
import { PG_POOL } from '../db/db.module';
import { withOrgContext } from '../db/tenant-context';
import { OutcomesService } from '../outcomes/outcomes.service';
import { srmCheck } from '../review/policy';
import {
  buildProblems,
  type ExperimentHealth,
  type HealthStatus,
  type LoopHealth,
  loopHealthLogLine,
  overallStatus,
  PREFERENCE_EXPIRY_WARN_HOURS,
  type Problem,
  STUCK_ACTION_MINUTES,
} from './loop-health-logic';

export interface LoopHealthView extends LoopHealth {
  status: HealthStatus;
  problems: Problem[];
}

/**
 * Loop health (T13): the counts the spec says to watch, for one workspace.
 * Read-only. The Review screen shows them, and the cron job writes one JSON
 * log line per workspace that Cloud Monitoring alerts on.
 */
@Injectable()
export class LoopHealthService {
  private readonly logger = new Logger(LoopHealthService.name);

  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    private readonly outcomes: OutcomesService,
  ) {}

  async compute(orgId: string, now = new Date()): Promise<LoopHealthView> {
    const base = await withOrgContext(this.pool, orgId, async (c) => {
      const exps = await c.query<{
        id: string;
        campaign_id: string;
        campaign_name: string;
        allocation: { weights?: number[] } | null;
      }>(
        `SELECT e.id, e.campaign_id, c.name AS campaign_name, e.allocation
           FROM experiments e JOIN campaigns c ON c.id = e.campaign_id
          WHERE e.status = 'running'
          ORDER BY e.created_at`,
      );
      const ids = exps.rows.map((e) => e.id);

      const assigned = await c.query<{
        experiment_id: string;
        variant_id: string;
        label: string;
        status: string;
        n: number;
      }>(
        `SELECT ev.experiment_id, ev.id AS variant_id, ev.label, ev.status,
                (SELECT count(*)::int FROM experiment_assignments ea
                  WHERE ea.variant_id = ev.id) AS n
           FROM experiment_variants ev
          WHERE ev.experiment_id = ANY($1::uuid[])
          ORDER BY ev.is_control DESC, ev.label, ev.id`,
        [ids],
      );

      const failed = await c.query<{ experiment_id: string; fg: string[] }>(
        `SELECT DISTINCT ON (r.experiment_id) r.experiment_id,
                COALESCE(r.result->'failedGates', '[]'::jsonb) AS fg
           FROM reviews r
          WHERE r.experiment_id = ANY($1::uuid[]) AND NOT r.simulated
          ORDER BY r.experiment_id, r.revision DESC`,
        [ids],
      );

      const unattr = await c.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM outcome_events
          WHERE experiment_id IS NULL AND campaign_lead_id IS NULL
            AND type IN ('reply','qualified_reply','booked_call')
            AND occurred_at > $1::timestamptz - interval '7 days'`,
        [now.toISOString()],
      );

      const stuck = await c.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM review_actions
          WHERE status IN ('requested','approved')
            AND requested_at < $1::timestamptz - make_interval(mins => $2)`,
        [now.toISOString(), STUCK_ACTION_MINUTES],
      );

      const alloc = await c.query<{ runs: number; fill: string | null }>(
        `SELECT count(*)::int AS runs, avg(fill)::text AS fill FROM (
           SELECT (allocation->>'targetedKept')::float
                  / NULLIF((allocation->>'cap')::float, 0) AS fill
             FROM prospect_runs
            WHERE preference_id IS NOT NULL
              AND allocation->>'finalized' = 'true'
              AND COALESCE(allocation->>'skipped', '') = ''
            ORDER BY created_at DESC LIMIT 5
         ) t`,
      );

      const expiring = await c.query<{
        id: string;
        label: string;
        expires_at: Date;
      }>(
        `SELECT id, label, expires_at FROM search_preferences
          WHERE status = 'active'
            AND expires_at < $1::timestamptz + make_interval(hours => $2)
          ORDER BY expires_at`,
        [now.toISOString(), PREFERENCE_EXPIRY_WARN_HOURS],
      );
      return { exps, assigned, failed, unattr, stuck, alloc, expiring };
    });

    const experiments: ExperimentHealth[] = [];
    const gateFailures: Record<string, number> = {};
    for (const e of base.exps.rows) {
      const variants = base.assigned.rows.filter(
        (a) => a.experiment_id === e.id,
      );
      const failedGates =
        base.failed.rows.find((f) => f.experiment_id === e.id)?.fg ?? [];
      for (const g of failedGates) gateFailures[g] = (gateFailures[g] ?? 0) + 1;

      // The planned split only holds while both versions are in use; after a
      // pause new companies all go to one version, which is not a defect.
      const allActive =
        variants.length === 2 && variants.every((v) => v.status === 'active');
      let srmP: number | null = null;
      let srmNote: string | null = null;
      if (allActive) {
        const w = e.allocation?.weights;
        const share =
          Array.isArray(w) && w.length === 2 && w[0] + w[1] > 0
            ? w[0] / (w[0] + w[1])
            : 0.5;
        srmP = srmCheck(variants[0].n, variants[1].n, share).p;
      } else {
        srmNote =
          'Not checked: a version is paused, so the planned split no longer applies.';
      }

      const cov = await this.outcomes.coverage(orgId, e.id);
      experiments.push({
        experimentId: e.id,
        campaignId: e.campaign_id,
        campaignName: e.campaign_name,
        assigned: variants.map((v) => ({
          variantId: v.variant_id,
          label: v.label,
          companies: v.n,
        })),
        srmP,
        srmNote,
        // nothing to measure until someone has replied
        coverage: cov.replyingCompanies > 0 ? cov.coverage : null,
        replyingCompanies: cov.replyingCompanies,
        failedGates,
      });
    }

    const health: LoopHealth = {
      generatedAt: now.toISOString(),
      experiments,
      unattributed7d: base.unattr.rows[0]?.n ?? 0,
      gateFailures,
      stuckActions: base.stuck.rows[0]?.n ?? 0,
      allocation: {
        runs: base.alloc.rows[0]?.runs ?? 0,
        avgFill:
          base.alloc.rows[0]?.fill !== null &&
          base.alloc.rows[0]?.fill !== undefined
            ? Number(base.alloc.rows[0].fill)
            : null,
      },
      preferencesExpiringSoon: base.expiring.rows.map((p) => ({
        id: p.id,
        label: p.label,
        expiresAt: p.expires_at.toISOString(),
      })),
    };
    const problems = buildProblems(health);
    return { ...health, status: overallStatus(problems), problems };
  }

  /** One log line for every workspace that has a running test or an active preference. */
  async runAll(): Promise<{ workspaces: number; bad: number; failed: number }> {
    const orgs = await this.pool.query<{ org_id: string }>(
      `SELECT org_id FROM loop_workspaces()`,
    );
    let bad = 0;
    let failed = 0;
    for (const { org_id: orgId } of orgs.rows) {
      try {
        if ((await this.logLine(orgId)).status === 'bad') bad += 1;
      } catch (e) {
        failed += 1;
        this.logger.warn(
          `loop health failed for ${orgId}: ${e instanceof Error ? e.message : String(e)}`,
        );
      }
    }
    return { workspaces: orgs.rows.length, bad, failed };
  }

  /** Computes and writes the one structured line per workspace that alerts read. */
  async logLine(orgId: string): Promise<LoopHealthView> {
    const h = await this.compute(orgId);
    // process.stdout: Cloud Run turns a JSON line into a Cloud Logging entry
    process.stdout.write(`${loopHealthLogLine(orgId, h, h.problems)}\n`);
    return h;
  }
}
