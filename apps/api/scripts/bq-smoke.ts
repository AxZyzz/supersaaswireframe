/**
 * Learning Loop T07: a real (non-Jest) run of the BigQuery Insights source.
 *
 *   npm run bq:smoke -w apps/api -- --org <workspace uuid>
 *   npm run bq:smoke -w apps/api -- --org <uuid> --compare      # also read Postgres and diff
 *   npm run bq:smoke -w apps/api -- --compare                   # picks the workspace with most sends
 *
 * Needs Google credentials (Cloud Run service account, or locally
 * `gcloud auth application-default login`) and GOOGLE_CLOUD_PROJECT (or
 * BIGQUERY_PROJECT). --compare also needs DATABASE_URL (the app role) pointing at the
 * SAME database Datastream copies (production, not your local one).
 *
 * It prints what BigQuery says and, with --compare, every number that differs
 * from Postgres. Differences that are EXPECTED in BigQuery mode: subject_length
 * (measured on the template text), and lead-level factors for old enrollments
 * that have no snapshot. Anything else is a bug: exit code 1 with --strict.
 */
import { config } from 'dotenv';
import { Pool } from 'pg';
import { LazyBigQueryRunner } from '../src/insights/bigquery-client';
import {
  BigQueryInsightsSource,
  DEFAULT_BQ_DATASET,
  DEFAULT_BQ_MAX_BYTES,
} from '../src/insights/bigquery-insights.source';
import { PostgresInsightsSource } from '../src/insights/postgres-insights.source';
import {
  type InsightsSideDataReader,
  PostgresSideData,
} from '../src/insights/postgres-side-data';
import type { InsightsData } from '../src/insights/types';

config({ path: ['.env', '../../.env'] });

const arg = (name: string): string | undefined => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const flag = (name: string) => process.argv.includes(`--${name}`);

const COUNTS = [
  'sent',
  'reached',
  'bounced',
  'opened',
  'replied',
  'positive',
  'qualified',
  'booked',
  'unsubscribed',
  'discovered',
  'eligible',
] as const;
/** Known to differ in BigQuery mode (see the header). */
const EXPECTED_TO_DIFFER = new Set(['subject_length']);

function diff(pg: InsightsData, bq: InsightsData): string[] {
  const out: string[] = [];
  for (const k of COUNTS) {
    if (pg.totals[k] !== bq.totals[k]) {
      out.push(
        `totals.${k}: postgres ${pg.totals[k]} vs bigquery ${bq.totals[k]}`,
      );
    }
  }
  for (const [factor, pgRows] of Object.entries(pg.buckets)) {
    const tag = EXPECTED_TO_DIFFER.has(factor) ? ' (expected to differ)' : '';
    const bqRows = bq.buckets[factor as keyof typeof bq.buckets];
    const byName = new Map(bqRows.map((r) => [r.bucket, r]));
    for (const r of pgRows) {
      const b = byName.get(r.bucket);
      if (!b) {
        out.push(
          `${factor}/${r.bucket}: only in postgres (reached ${r.reached})${tag}`,
        );
        continue;
      }
      for (const k of COUNTS) {
        if (r[k] !== b[k]) {
          out.push(
            `${factor}/${r.bucket}.${k}: postgres ${r[k]} vs bigquery ${b[k]}${tag}`,
          );
        }
      }
      byName.delete(r.bucket);
    }
    for (const [name, r] of byName) {
      out.push(
        `${factor}/${name}: only in bigquery (reached ${r.reached})${tag}`,
      );
    }
  }
  return out;
}

async function main() {
  const project =
    process.env.BIGQUERY_PROJECT || process.env.GOOGLE_CLOUD_PROJECT || '';
  if (!project)
    throw new Error('set GOOGLE_CLOUD_PROJECT (or BIGQUERY_PROJECT)');
  const location = process.env.BIGQUERY_LOCATION || 'asia-south1';
  const compare = flag('compare');
  const needsPg = compare || !flag('no-side-data');

  // The numbers must come through the APP role (DATABASE_URL), which row-level security
  // limits to one workspace at a time. The owner role (MIGRATE_DATABASE_URL) bypasses RLS and
  // would count every workspace, so it is used only to pick a workspace when none is given.
  const pool = needsPg
    ? new Pool({
        connectionString:
          process.env.DATABASE_URL ?? process.env.MIGRATE_DATABASE_URL,
      })
    : null;

  let orgId = arg('org');
  if (!orgId && pool) {
    const owner = new Pool({
      connectionString:
        process.env.MIGRATE_DATABASE_URL ?? process.env.DATABASE_URL,
    });
    const r = await owner.query<{ org_id: string }>(
      `SELECT org_id FROM sent_emails GROUP BY org_id ORDER BY count(*) DESC LIMIT 1`,
    );
    await owner.end();
    orgId = r.rows[0]?.org_id;
  }
  if (!orgId) throw new Error('pass --org <workspace uuid>');

  const side: InsightsSideDataReader = pool
    ? new PostgresSideData(pool)
    : {
        read: () =>
          Promise.resolve({
            workspaceTz: 'UTC',
            prospects: [],
            senderEmails: new Map(),
          }),
      };
  const bq = new BigQueryInsightsSource(
    new LazyBigQueryRunner(project, location),
    side,
    {
      project,
      dataset: process.env.BIGQUERY_DATASET || DEFAULT_BQ_DATASET,
      location,
      maxBytesBilled: DEFAULT_BQ_MAX_BYTES,
    },
  );
  const q = { orgId, offerId: arg('offer') };

  const t0 = Date.now();
  const bqData = await bq.all(q);
  console.log(`BigQuery answered in ${Date.now() - t0} ms for org ${orgId}`);
  console.log(
    'data as of:',
    bqData.dataAsOf?.toISOString() ?? 'nothing replicated yet',
  );
  console.log('totals:', JSON.stringify(bqData.totals));
  console.log(
    'top cities:',
    bqData.buckets.city
      .slice(0, 5)
      .map(
        (b) =>
          `${b.bucket} (reached ${b.reached}, replied ${b.replied}, qualified ${b.qualified})`,
      )
      .join('; ') || '(none)',
  );

  let exit = 0;
  if (compare && pool) {
    const pgData = await new PostgresInsightsSource(pool).all(q);
    const diffs = diff(pgData, bqData);
    const real = diffs.filter((d) => !d.includes('(expected to differ)'));
    console.log(
      `\ncompare with Postgres: ${diffs.length} difference(s), ${real.length} not expected`,
    );
    for (const d of diffs) console.log('  -', d);
    if (real.length === 0)
      console.log('MATCH: every count agrees (apart from the expected ones).');
    if (flag('strict') && real.length > 0) exit = 1;
  }
  await pool?.end();
  process.exitCode = exit;
}

main().catch((e) => {
  console.error('bq-smoke failed:', e instanceof Error ? e.message : e);
  process.exit(1);
});
