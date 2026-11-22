import { Logger } from '@nestjs/common';
import { aggregateInsights, type InsightCompany } from './aggregate-insights';
import { type CompanyRow, toInsightCompany } from './company-row';
import type { InsightsSideDataReader } from './postgres-side-data';
import type {
  BucketRow,
  FactorId,
  GridRow,
  InsightsData,
  InsightsQuery,
  InsightsSource,
} from './types';

/**
 * Insights from BigQuery (Learning Loop T07). The numbers come from the modelled
 * view `expelly_learning.company_reach` (one row per workspace + campaign +
 * company, built from the Datastream copy of the analytics tables). The rows go
 * through the same toInsightCompany() and aggregateInsights() as the Postgres
 * source, so both sources can only differ in the facts they read.
 *
 * Rules (the tests enforce them):
 *  - EVERY query filters `org_id = @org_id`. BigQuery has no row-level security
 *    here, so this clause is the tenant wall.
 *  - Parameterised queries only; nothing user-supplied is ever put in the SQL text.
 *  - It only reads `expelly_learning` views, never `expelly_raw`.
 *  - A byte cap on every query, so a bad filter can never run up a bill.
 */

/** The slice of the BigQuery client this source uses (a fake implements it in tests). */
export interface BigQueryRunner {
  query(options: {
    query: string;
    params: Record<string, unknown>;
    types: Record<string, string | string[]>;
    location: string;
    maximumBytesBilled: string;
    labels: Record<string, string>;
  }): Promise<[Array<Record<string, unknown>>, ...unknown[]]>;
}

export interface BigQuerySourceConfig {
  project: string;
  /** The modelled dataset (default `expelly_learning`). */
  dataset: string;
  location: string;
  maxBytesBilled: number;
}

export const DEFAULT_BQ_DATASET = 'expelly_learning';
export const DEFAULT_BQ_MAX_BYTES = 1_073_741_824; // 1 GiB per query

/** Every SQL string this source can run. Exported so the tests can check each one. */
export function buildQueries(
  cfg: Pick<BigQuerySourceConfig, 'project' | 'dataset'>,
) {
  const view = (name: string) => `\`${cfg.project}.${cfg.dataset}.${name}\``;
  return {
    /**
     * One row per company: its FIRST first-touch email across the campaigns in
     * scope. Same rule as the Postgres source (a company is counted once, by its
     * earliest step-1 send).
     */
    companies: `SELECT * FROM ${view('company_reach')}
WHERE org_id = @org_id
  AND (@offer_id IS NULL OR offer_id = @offer_id)
  AND (ARRAY_LENGTH(@campaign_ids) = 0 OR campaign_id IN UNNEST(@campaign_ids))
  AND (@from_ts IS NULL OR first_sent_at >= @from_ts)
  AND (@to_ts IS NULL OR first_sent_at < @to_ts)
QUALIFY ROW_NUMBER() OVER (PARTITION BY company_key ORDER BY first_sent_at, campaign_id) = 1`,
    /** Newest database change of this workspace that has reached BigQuery. */
    freshness: `SELECT last_change FROM ${view('data_freshness')}
WHERE org_id = @org_id`,
  };
}

const SNAP_TEXT_COLUMNS: Array<[column: string, snapKey: string]> = [
  ['country', 'country'],
  ['region', 'region'],
  ['city', 'city'],
  ['industry', 'industry'],
  ['size_band', 'size_band'],
  ['primary_trigger', 'primary_trigger'],
  ['role_bucket', 'role_bucket'],
  ['lead_source', 'source'],
  ['mail_provider', 'mail_provider'],
  ['timezone', 'timezone'],
];

const asDate = (v: unknown): Date | null => {
  if (v === null || v === undefined) return null;
  // BigQuery's client wraps TIMESTAMPs as { value: '2026-...' }
  const raw = typeof v === 'object' && 'value' in v ? v.value : v;
  if (raw instanceof Date) return Number.isNaN(raw.getTime()) ? null : raw;
  if (typeof raw !== 'string' && typeof raw !== 'number') return null;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
};
const asBool = (v: unknown): boolean | null =>
  v === null || v === undefined ? null : v === true || v === 'true';
const asText = (v: unknown): string | null =>
  typeof v === 'string' && v !== '' ? v : null;
const asInt = (v: unknown): number | null => {
  if (v === null || v === undefined) return null;
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
};

/** A company_reach row -> the shape both sources feed to toInsightCompany(). */
export function companyRowFromBigQuery(
  r: Record<string, unknown>,
  senderEmails: Map<string, string>,
): CompanyRow {
  // Rebuild the enrollment snapshot from the whitelisted view columns, so the
  // mapping code is the one the Postgres source uses.
  const snap: Record<string, unknown> = {};
  for (const [column, key] of SNAP_TEXT_COLUMNS) {
    const v = asText(r[column]);
    if (v) snap[key] = v;
  }
  const stars = asInt(r.stars);
  if (stars !== null) snap.stars = stars;

  const senderId = asText(r.sender_id);
  return {
    company_key: String(r.company_key),
    first_sent: asDate(r.first_sent_at) as Date,
    snap: Object.keys(snap).length > 0 ? snap : null,
    // BigQuery holds no leads table: old enrollments with no snapshot show "unknown"
    lead_city: null,
    lead_region: null,
    lead_country: null,
    lead_mail_provider: null,
    lead_source: null,
    lead_title: null,
    sender_email: senderId ? (senderEmails.get(senderId) ?? null) : null,
    subject: asText(r.subject_text),
    template_subject: asText(r.template_subject),
    variant_label: asText(r.variant_label),
    bounced: asBool(r.bounced),
    opened: asBool(r.opened) === true,
    replied: asBool(r.replied),
    positive: asBool(r.positive),
    qualified: asBool(r.qualified_verified),
    booked: asBool(r.booked),
    unsubscribed: asBool(r.unsubscribed),
    first_reply_at: asDate(r.first_reply_at),
    reply_step: asInt(r.reply_step),
  };
}

export class BigQueryInsightsSource implements InsightsSource {
  readonly name = 'bigquery';
  private readonly sql: ReturnType<typeof buildQueries>;

  constructor(
    private readonly bq: BigQueryRunner,
    private readonly side: InsightsSideDataReader,
    private readonly cfg: BigQuerySourceConfig,
  ) {
    this.sql = buildQueries(cfg);
  }

  async factorFunnel(q: InsightsQuery, factor: FactorId): Promise<BucketRow[]> {
    return (await this.all(q)).buckets[factor];
  }

  async sendTimeGrid(q: InsightsQuery): Promise<GridRow[]> {
    return (await this.all(q)).grid;
  }

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
      labels: { app: 'expelly', purpose: 'insights' },
    });
  }

  async all(q: InsightsQuery): Promise<InsightsData> {
    const [[rows], [fresh], side] = await Promise.all([
      this.run(
        this.sql.companies,
        {
          org_id: q.orgId,
          offer_id: q.offerId ?? null,
          campaign_ids: q.campaignIds ?? [],
          from_ts: q.from ? q.from.toISOString() : null,
          to_ts: q.to ? q.to.toISOString() : null,
        },
        {
          org_id: 'STRING',
          offer_id: 'STRING',
          campaign_ids: ['STRING'],
          from_ts: 'TIMESTAMP',
          to_ts: 'TIMESTAMP',
        },
      ),
      this.run(this.sql.freshness, { org_id: q.orgId }, { org_id: 'STRING' }),
      this.side.read(q),
    ]);

    const companies: InsightCompany[] = rows.map((r) =>
      toInsightCompany(companyRowFromBigQuery(r, side.senderEmails)),
    );
    const data = aggregateInsights(companies, side.prospects, side.workspaceTz);
    return { ...data, dataAsOf: asDate(fresh[0]?.last_change) };
  }
}

/**
 * BigQuery first, Postgres if BigQuery fails. Insights are exploratory (they
 * never decide anything), so a slow or broken BigQuery must not break the page.
 * The response says which source answered, and the failure is logged.
 */
export class FallbackInsightsSource implements InsightsSource {
  private readonly logger = new Logger(FallbackInsightsSource.name);

  constructor(
    private readonly primary: InsightsSource,
    private readonly fallback: InsightsSource,
  ) {}

  get name(): string {
    return this.primary.name;
  }

  async factorFunnel(q: InsightsQuery, factor: FactorId): Promise<BucketRow[]> {
    return (await this.all(q)).buckets[factor];
  }

  async sendTimeGrid(q: InsightsQuery): Promise<GridRow[]> {
    return (await this.all(q)).grid;
  }

  async all(q: InsightsQuery): Promise<InsightsData> {
    try {
      return await this.primary.all(q);
    } catch (e) {
      this.logger.warn(
        `insights: ${this.primary.name} failed, answering from ${this.fallback.name}: ${(e as Error).message}`,
      );
      return { ...(await this.fallback.all(q)), source: this.fallback.name };
    }
  }
}
