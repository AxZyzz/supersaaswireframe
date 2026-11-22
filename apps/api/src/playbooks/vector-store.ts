import type { BigQueryRunner } from '../insights/bigquery-insights.source';

/**
 * Where playbook VECTORS live (Learning Loop T14): the BigQuery table
 * `expelly_memory.playbook_vectors`. It holds ids, the offer, the expiry and
 * the vector, and nothing else: the title and body stay in Postgres, so no
 * text (and no lead data) ever reaches BigQuery. The dataset is separate from
 * `expelly_learning` so the API's read-only analytics dataset stays read-only.
 *
 * Rules (the tests enforce them):
 *  - EVERY statement filters or writes `org_id = @org_id`. BigQuery has no
 *    row-level security here, so this clause is the tenant wall. The caller
 *    also re-checks every hit against Postgres.
 *  - Parameterised statements only; the one number in the SQL text is the
 *    validated top-k.
 *  - A byte cap on every job.
 */
export interface VectorRecord {
  orgId: string;
  playbookId: string;
  version: number;
  offerId: string;
  embedding: number[];
  validTo: Date;
}

export interface VectorQuery {
  orgId: string;
  offerId: string;
  embedding: number[];
  k: number;
}

export interface VectorHit {
  playbookId: string;
  /** Cosine distance: 0 is identical, 2 is opposite. */
  distance: number;
}

export interface PlaybookVectorStore {
  readonly name: string;
  upsert(r: VectorRecord): Promise<void>;
  remove(orgId: string, playbookId: string): Promise<void>;
  search(q: VectorQuery): Promise<VectorHit[]>;
}

export const PLAYBOOK_VECTOR_STORE = Symbol('PLAYBOOK_VECTOR_STORE');

export const DEFAULT_MEMORY_DATASET = 'expelly_memory';
export const MAX_TOP_K = 10;

export interface BigQueryStoreConfig {
  project: string;
  dataset: string;
  location: string;
  maxBytesBilled: number;
}

/** Every SQL string the store can run. Exported so the tests can check each one. */
export function buildVectorQueries(
  cfg: Pick<BigQueryStoreConfig, 'project' | 'dataset'>,
  k: number,
) {
  if (!Number.isInteger(k) || k < 1 || k > MAX_TOP_K) {
    throw new Error(`top-k must be a whole number from 1 to ${MAX_TOP_K}`);
  }
  const table = `\`${cfg.project}.${cfg.dataset}.playbook_vectors\``;
  return {
    remove: `DELETE FROM ${table}
WHERE org_id = @org_id AND playbook_id = @playbook_id`,
    upsert: `BEGIN TRANSACTION;
DELETE FROM ${table} WHERE org_id = @org_id AND playbook_id = @playbook_id;
INSERT INTO ${table} (org_id, playbook_id, version, offer_id, embedding, valid_to, updated_at)
VALUES (@org_id, @playbook_id, @version, @offer_id, @embedding, @valid_to, CURRENT_TIMESTAMP());
COMMIT TRANSACTION;`,
    search: `SELECT base.playbook_id AS playbook_id, distance
FROM VECTOR_SEARCH(
  (SELECT * FROM ${table}
   WHERE org_id = @org_id AND offer_id = @offer_id AND valid_to > CURRENT_TIMESTAMP()),
  'embedding',
  (SELECT @query_embedding AS embedding),
  top_k => ${k},
  distance_type => 'COSINE')
ORDER BY distance`,
  };
}

export class BigQueryPlaybookVectorStore implements PlaybookVectorStore {
  readonly name = 'bigquery';

  constructor(
    private readonly bq: BigQueryRunner,
    private readonly cfg: BigQueryStoreConfig,
  ) {}

  private run(
    query: string,
    params: Record<string, unknown>,
    types: Record<string, string | string[]>,
  ) {
    return this.bq.query({
      query,
      params,
      types,
      location: this.cfg.location,
      maximumBytesBilled: String(this.cfg.maxBytesBilled),
      labels: { app: 'expelly', purpose: 'playbooks' },
    });
  }

  async upsert(r: VectorRecord): Promise<void> {
    await this.run(
      buildVectorQueries(this.cfg, 1).upsert,
      {
        org_id: r.orgId,
        playbook_id: r.playbookId,
        version: r.version,
        offer_id: r.offerId,
        embedding: r.embedding,
        valid_to: r.validTo.toISOString(),
      },
      {
        org_id: 'STRING',
        playbook_id: 'STRING',
        version: 'INT64',
        offer_id: 'STRING',
        embedding: ['FLOAT64'],
        valid_to: 'TIMESTAMP',
      },
    );
  }

  async remove(orgId: string, playbookId: string): Promise<void> {
    await this.run(
      buildVectorQueries(this.cfg, 1).remove,
      { org_id: orgId, playbook_id: playbookId },
      { org_id: 'STRING', playbook_id: 'STRING' },
    );
  }

  async search(q: VectorQuery): Promise<VectorHit[]> {
    const [rows] = await this.run(
      buildVectorQueries(this.cfg, q.k).search,
      { org_id: q.orgId, offer_id: q.offerId, query_embedding: q.embedding },
      {
        org_id: 'STRING',
        offer_id: 'STRING',
        query_embedding: ['FLOAT64'],
      },
    );
    return rows.map((r) => ({
      playbookId: String(r.playbook_id),
      distance: Number(r.distance),
    }));
  }
}

/** No vector index (PLAYBOOK_SEARCH=postgres): saving still works, retrieval uses keywords. */
export class NoopVectorStore implements PlaybookVectorStore {
  readonly name = 'none';
  upsert(): Promise<void> {
    return Promise.resolve();
  }
  remove(): Promise<void> {
    return Promise.resolve();
  }
  search(): Promise<VectorHit[]> {
    return Promise.resolve([]);
  }
}
