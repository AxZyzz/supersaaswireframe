/**
 * Local-development helper for the search preference browser test (T12).
 * Works on the Review demo workspace made by `npm run seed:experiment`.
 *
 *   npm run seed:preference-demo -w apps/api -- reset
 *       removes the demo workspace's search preferences and the demo runs, so
 *       the same Insights headline can be approved again
 *   npm run seed:preference-demo -w apps/api -- run
 *       adds ONE finished, clearly labelled demo Discover run pinned to the
 *       active preference (12 companies, 2 found through it), so the run
 *       header and the "From preference" chips can be seen without calling
 *       the AI. The real pipeline is covered by the integration tests.
 *
 * Writes straight to the local database. Never run it against a real workspace.
 */
import 'dotenv/config';
import { Pool } from 'pg';
import { withOrgContext } from '../src/db/tenant-context';

const EMAIL = 'review-demo@supersaas.local';
const GOAL = 'T12 demo search (seeded, not a real search)';

async function main() {
  const mode = process.argv[2];
  if (mode !== 'reset' && mode !== 'run') {
    throw new Error('Usage: seed-search-preference-demo.ts reset|run');
  }
  const pool = new Pool({
    connectionString:
      process.env.DATABASE_URL ??
      'postgresql://supersaas_app:supersaas_app@localhost:5432/supersaas',
  });
  const u = await pool.query<{ id: string }>(
    `SELECT id FROM users WHERE email = $1`,
    [EMAIL],
  );
  if (!u.rows[0]) throw new Error('Run npm run seed:experiment first.');
  const m = await pool.query<{ org_id: string }>(
    `SELECT org_id FROM user_memberships($1)`,
    [u.rows[0].id],
  );
  const orgId = m.rows[0].org_id;

  await withOrgContext(pool, orgId, async (c) => {
    if (mode === 'reset') {
      await c.query(`DELETE FROM prospect_runs WHERE goal = $1`, [GOAL]);
      await c.query(`DELETE FROM search_preferences`);
      console.log('Reset: search preferences and demo runs removed.');
      return;
    }
    const pref = await c.query<{
      id: string;
      offer_id: string;
      revision: number;
      label: string;
    }>(
      `SELECT id, offer_id, revision, label FROM search_preferences
        WHERE status = 'active' LIMIT 1`,
    );
    if (!pref.rows[0]) throw new Error('Approve a search preference first.');
    const p = pref.rows[0];
    const allocation = {
      batchSize: 12,
      cap: 2,
      capShare: 0.2,
      factor: 'city',
      value: 'Pune',
      label: p.label,
      targetedRequested: 4,
      targetedFound: 1,
      targetedKept: 1,
      shortfall: 1,
      baselineFilled: 1,
      dedupedOverlap: 0,
      finalized: true,
    };
    const run = await c.query<{ id: string }>(
      `INSERT INTO prospect_runs
         (org_id, goal, status, requested, total, done, verified, offer_id,
          preference_id, preference_revision, allocation, icp, finished_at)
       VALUES ($1,$2,'done',12,13,13,13,$3,$4,$5,$6::jsonb,
               '{"summary":"Independent clinics (demo)","industries":[],"regions":[],"buyerRoles":[]}'::jsonb,
               now())
       RETURNING id`,
      [orgId, GOAL, p.offer_id, p.id, p.revision, JSON.stringify(allocation)],
    );
    for (let i = 1; i <= 13; i++) {
      const targeted = i <= 1;
      await c.query(
        `INSERT INTO prospects
           (org_id, run_id, company_name, domain, status, summary, city, country,
            industry, fit_score, stars, via_preference, emails, evidence)
         VALUES ($1,$2,$3,$4,'verified','Demo company',$5,'IN','healthcare_clinic',
                 $6,4,$7,'[]'::jsonb,'[]'::jsonb)`,
        [
          orgId,
          run.rows[0].id,
          targeted ? `Pune Clinic ${i}` : `Demo Clinic ${i}`,
          `demo-${i}.example`,
          targeted ? 'Pune' : 'Mumbai',
          90 - i,
          targeted,
        ],
      );
    }
    console.log(
      'Seeded one finished demo run pinned to the active preference.',
    );
  });
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
