/**
 * Learning Loop T14: a real (non-Jest) run of embeddings + BigQuery VECTOR_SEARCH.
 *
 *   npm run playbooks:smoke -w apps/api
 *
 * Needs Google credentials (Cloud Run service account, or locally
 * `gcloud auth application-default login`), GOOGLE_CLOUD_PROJECT (or BIGQUERY_PROJECT) and
 * EMBEDDINGS_USE_VERTEX=true (or GEMINI_API_KEY). It does NOT touch Postgres or any real workspace.
 *
 * What it does: writes five throwaway vectors under two made-up workspaces and two made-up offers
 * (one expired, one in another offer, one in another workspace, all with the same text as the good one),
 * asks for the closest playbooks of workspace A / offer X, and checks that ONLY workspace A's unexpired
 * playbooks of that offer come back. Then it deletes everything it wrote. Exit code 1 if anything is off.
 */
import { ConfigService } from '@nestjs/config';
import { config } from 'dotenv';
import { randomUUID } from 'crypto';
import { LazyBigQueryRunner } from '../src/insights/bigquery-client';
import { DEFAULT_BQ_MAX_BYTES } from '../src/insights/bigquery-insights.source';
import { GeminiEmbeddingProvider } from '../src/playbooks/embedding.provider';
import {
  BigQueryPlaybookVectorStore,
  DEFAULT_MEMORY_DATASET,
  type VectorRecord,
} from '../src/playbooks/vector-store';

config({ path: ['.env', '../../.env'] });

const DAY = 86_400_000;

async function main() {
  const project =
    process.env.BIGQUERY_PROJECT || process.env.GOOGLE_CLOUD_PROJECT || '';
  if (!project)
    throw new Error('set GOOGLE_CLOUD_PROJECT (or BIGQUERY_PROJECT)');
  const location = process.env.BIGQUERY_LOCATION || 'asia-south1';
  const dataset = process.env.BIGQUERY_MEMORY_DATASET || DEFAULT_MEMORY_DATASET;

  const embeddings = new GeminiEmbeddingProvider(
    new ConfigService({ ...process.env }),
  );
  const store = new BigQueryPlaybookVectorStore(
    new LazyBigQueryRunner(project, location),
    { project, dataset, location, maxBytesBilled: DEFAULT_BQ_MAX_BYTES },
  );
  console.log(
    `embeddings: ${embeddings.name} (${embeddings.dims} dims, ` +
      `${process.env.EMBEDDINGS_USE_VERTEX === 'true' ? 'Vertex AI ' + (process.env.EMBEDDINGS_LOCATION || 'us-central1') : 'AI Studio key'})`,
  );
  console.log(`vectors: ${project}.${dataset}.playbook_vectors (${location})`);

  const run = randomUUID().slice(0, 8);
  const orgA = `smoke-org-a-${run}`;
  const orgB = `smoke-org-b-${run}`;
  const offerX = `smoke-offer-x-${run}`;
  const offerY = `smoke-offer-y-${run}`;

  const SUBJECTS =
    'A short question as the subject line beat a plain greeting for clinic follow-ups: more confirmed qualified replies.';
  const CITY =
    'Dental practices in Pune replied more often than in other cities. An observation to keep testing, not proof.';

  const plan: Array<{
    label: string;
    rec: Omit<VectorRecord, 'embedding'>;
    text: string;
  }> = [
    {
      label: 'A1 same workspace, same offer, valid (subjects)',
      text: SUBJECTS,
      rec: {
        orgId: orgA,
        playbookId: `${run}-a1`,
        version: 1,
        offerId: offerX,
        validTo: new Date(Date.now() + 90 * DAY),
      },
    },
    {
      label: 'A2 same workspace, same offer, valid (city)',
      text: CITY,
      rec: {
        orgId: orgA,
        playbookId: `${run}-a2`,
        version: 1,
        offerId: offerX,
        validTo: new Date(Date.now() + 90 * DAY),
      },
    },
    {
      label: 'A3 same text as A1 but EXPIRED yesterday',
      text: SUBJECTS,
      rec: {
        orgId: orgA,
        playbookId: `${run}-a3`,
        version: 1,
        offerId: offerX,
        validTo: new Date(Date.now() - DAY),
      },
    },
    {
      label: 'A4 same text as A1 but ANOTHER OFFER',
      text: SUBJECTS,
      rec: {
        orgId: orgA,
        playbookId: `${run}-a4`,
        version: 1,
        offerId: offerY,
        validTo: new Date(Date.now() + 90 * DAY),
      },
    },
    {
      label: 'B1 same text as A1 but ANOTHER WORKSPACE',
      text: SUBJECTS,
      rec: {
        orgId: orgB,
        playbookId: `${run}-b1`,
        version: 1,
        offerId: offerX,
        validTo: new Date(Date.now() + 90 * DAY),
      },
    },
  ];

  const failures: string[] = [];
  const check = (ok: boolean, what: string) => {
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}`);
    if (!ok) failures.push(what);
  };

  try {
    for (const p of plan) {
      const embedding = await embeddings.embed(p.text, 'RETRIEVAL_DOCUMENT');
      await store.upsert({ ...p.rec, embedding });
      console.log(`wrote ${p.label}`);
    }
    const query = await embeddings.embed(
      'which subject line style gets more replies from clinics',
      'RETRIEVAL_QUERY',
    );

    const t0 = Date.now();
    const hitsA = await store.search({
      orgId: orgA,
      offerId: offerX,
      embedding: query,
      k: 3,
    });
    console.log(
      `search A/X answered in ${Date.now() - t0} ms:`,
      hitsA.map((h) => `${h.playbookId} (${h.distance.toFixed(4)})`).join(', '),
    );
    const idsA = hitsA.map((h) => h.playbookId);
    check(
      idsA.length === 2 &&
        idsA.includes(`${run}-a1`) &&
        idsA.includes(`${run}-a2`),
      'workspace A / offer X returns exactly its two unexpired playbooks (no expired, no other offer, no other workspace)',
    );
    check(
      idsA[0] === `${run}-a1`,
      'the subject-line playbook ranks above the city one for a subject-line question',
    );

    const hitsB = await store.search({
      orgId: orgB,
      offerId: offerX,
      embedding: query,
      k: 3,
    });
    check(
      hitsB.length === 1 && hitsB[0].playbookId === `${run}-b1`,
      'workspace B sees only its own playbook',
    );

    await store.remove(orgA, `${run}-a1`);
    const afterRemove = await store.search({
      orgId: orgA,
      offerId: offerX,
      embedding: query,
      k: 3,
    });
    check(
      afterRemove.length === 1 && afterRemove[0].playbookId === `${run}-a2`,
      'a removed (retired) playbook is no longer returned',
    );
  } finally {
    for (const p of plan) {
      await store
        .remove(p.rec.orgId, p.rec.playbookId)
        .catch((e) => console.error('cleanup failed for', p.rec.playbookId, e));
    }
    console.log('cleanup: smoke rows deleted');
  }

  if (failures.length > 0) {
    console.error(`\nSMOKE FAILED (${failures.length})`);
    process.exit(1);
  }
  console.log('\nSMOKE PASSED');
}

main().catch((e) => {
  console.error('playbook-smoke failed:', e instanceof Error ? e.message : e);
  process.exit(1);
});
