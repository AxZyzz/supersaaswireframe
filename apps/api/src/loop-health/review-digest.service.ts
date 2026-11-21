import { Inject, Injectable } from '@nestjs/common';
import { Pool } from 'pg';
import { PG_POOL } from '../db/db.module';
import { withOrgContext } from '../db/tenant-context';

const DECISION_WORDS: Record<string, string> = {
  promote: 'a winner was found',
  inconclusive: 'no clear winner yet',
  guardrail_breach: 'a deliverability limit was crossed',
  keep_collecting: 'still collecting results',
};

/**
 * The "Campaign Review" lines of the Monday summary email (T13): one line per
 * real A/B test (what Review currently says) and one per active search
 * preference (found vs target, days left). Simulated reviews belong to no
 * experiment, so they can never appear here.
 */
@Injectable()
export class ReviewDigestService {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  async lines(orgId: string, web: string): Promise<string[]> {
    return withOrgContext(this.pool, orgId, async (c) => {
      const exps = await c.query<{
        name: string;
        status: string;
        decision: string | null;
      }>(
        `SELECT c.name, e.status,
                (SELECT r.result->>'decision' FROM reviews r
                  WHERE r.experiment_id = e.id AND NOT r.simulated
                  ORDER BY r.revision DESC LIMIT 1) AS decision
           FROM experiments e JOIN campaigns c ON c.id = e.campaign_id
          WHERE e.status = 'running'
             OR (e.status = 'decided' AND e.decided_at > now() - interval '14 days')
          ORDER BY (e.status = 'running') DESC, e.created_at DESC
          LIMIT 5`,
      );
      const prefs = await c.query<{
        label: string;
        days_left: number;
        kept: string | null;
        cap: string | null;
      }>(
        `SELECT sp.label,
                GREATEST(0, ceil(extract(epoch FROM (sp.expires_at - now())) / 86400))::int AS days_left,
                (SELECT sum((r.allocation->>'targetedKept')::int)::text FROM prospect_runs r
                  WHERE r.preference_id = sp.id AND r.allocation->>'finalized' = 'true') AS kept,
                (SELECT sum((r.allocation->>'cap')::int)::text FROM prospect_runs r
                  WHERE r.preference_id = sp.id AND r.allocation->>'finalized' = 'true') AS cap
           FROM search_preferences sp
          WHERE sp.status = 'active'
          ORDER BY sp.expires_at
          LIMIT 3`,
      );
      const out: string[] = [];
      for (const e of exps.rows) {
        const state =
          e.status === 'decided'
            ? 'ended; a new challenger test replaced it'
            : (DECISION_WORDS[e.decision ?? ''] ?? 'no review yet');
        out.push(`• ${e.name}: ${state}. ${web}/campaigns`);
      }
      for (const p of prefs.rows) {
        const found =
          p.cap !== null
            ? `found ${p.kept ?? 0} of ${p.cap} reserved slots`
            : 'not used by a search yet';
        out.push(
          `• Search preference "${p.label}": ${found}, ${p.days_left} day${p.days_left === 1 ? '' : 's'} left. ${web}/discover`,
        );
      }
      return out;
    });
  }
}
