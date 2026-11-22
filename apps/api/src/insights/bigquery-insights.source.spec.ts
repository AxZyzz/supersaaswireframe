import { readFileSync } from 'fs';
import { join } from 'path';
import {
  type BigQueryRunner,
  BigQueryInsightsSource,
  buildQueries,
  companyRowFromBigQuery,
  FallbackInsightsSource,
} from './bigquery-insights.source';
import { type CompanyRow, toInsightCompany } from './company-row';
import type {
  InsightsSideData,
  InsightsSideDataReader,
} from './postgres-side-data';
import { assertInsightsSourceContract } from './source-contract';
import type { InsightsData, InsightsQuery, InsightsSource } from './types';

const ORG = '11111111-1111-1111-1111-111111111111';
const OTHER_ORG = '22222222-2222-2222-2222-222222222222';
const CFG = {
  project: 'test-project',
  dataset: 'expelly_learning',
  location: 'asia-south1',
  maxBytesBilled: 1_000_000,
};

type Row = Record<string, unknown>;

/** A company_reach row, as BigQuery's client returns it (timestamps are {value}). */
const reach = (o: Partial<Row> & { company_key: string }): Row => ({
  org_id: ORG,
  campaign_id: 'cmp-1',
  offer_id: 'offer-1',
  first_sent_at: { value: '2026-11-03T05:00:00.000Z' }, // Tue 10:30 IST
  country: 'IN',
  region: 'Maharashtra',
  city: 'Pune',
  industry: 'saas',
  size_band: '11-50',
  primary_trigger: 'hiring',
  role_bucket: 'founder_owner',
  lead_source: 'expelly',
  mail_provider: 'google',
  timezone: 'Asia/Kolkata',
  stars: 4,
  variant_label: 'A',
  sender_id: 'sender-1',
  subject_text: 'Quick question about {{company}}',
  template_subject: 'Quick question about {{company}}',
  bounced: false,
  opened: false,
  replied: false,
  positive: false,
  qualified_verified: false,
  booked: false,
  unsubscribed: false,
  first_reply_at: null,
  reply_step: null,
  ...o,
});

const FIXTURE: Row[] = [
  reach({
    company_key: 'a.example',
    opened: true,
    replied: true,
    positive: true,
    qualified_verified: true,
    booked: true,
    first_reply_at: { value: '2026-11-03T17:00:00.000Z' },
    reply_step: 1,
  }),
  reach({
    company_key: 'b.example',
    city: 'Mumbai',
    variant_label: 'B',
    opened: true,
    replied: true,
    first_reply_at: { value: '2026-11-04T05:00:00.000Z' },
    reply_step: 2,
  }),
  reach({ company_key: 'c.example', city: 'Mumbai', bounced: true }),
  reach({
    company_key: 'd.example',
    city: 'Delhi',
    primary_trigger: 'funding',
    unsubscribed: true,
  }),
  // an old enrollment with no snapshot at all: everything is "unknown"
  reach({
    company_key: 'e.example',
    country: null,
    region: null,
    city: null,
    industry: null,
    size_band: null,
    primary_trigger: null,
    role_bucket: null,
    lead_source: null,
    mail_provider: null,
    timezone: null,
    stars: null,
    variant_label: null,
    sender_id: null,
    subject_text: null,
    template_subject: null,
  }),
  reach({ company_key: 'f.example', city: 'Pune', sender_id: 'sender-2' }),
];

const SIDE: InsightsSideData = {
  workspaceTz: 'Asia/Kolkata',
  prospects: [
    {
      country: 'IN',
      region: 'Maharashtra',
      city: 'Pune',
      industry: 'saas',
      size_band: '11-50',
      trigger: 'hiring',
      eligible: true,
    },
    {
      country: 'IN',
      region: 'Maharashtra',
      city: 'Pune',
      industry: 'saas',
      size_band: '11-50',
      trigger: 'hiring',
      eligible: false,
    },
    {
      country: 'IN',
      region: 'Delhi',
      city: 'Delhi',
      industry: 'retail',
      size_band: '51-200',
      trigger: 'funding',
      eligible: true,
    },
  ],
  senderEmails: new Map([
    ['sender-1', 'one@sender.test'],
    ['sender-2', 'two@sender.test'],
  ]),
};

interface Call {
  query: string;
  params: Record<string, unknown>;
  types: Record<string, unknown>;
  location: string;
  maximumBytesBilled: string;
}

function fakeBigQuery(opts: {
  rows?: Row[];
  freshness?: Row[];
  fail?: boolean;
}) {
  const calls: Call[] = [];
  const bq: BigQueryRunner = {
    query: (o) => {
      calls.push(o);
      if (opts.fail) return Promise.reject(new Error('BigQuery is down'));
      const out = o.query.includes('data_freshness')
        ? (opts.freshness ?? [])
        : (opts.rows ?? FIXTURE);
      return Promise.resolve([out]);
    },
  };
  return { bq, calls };
}

const side: InsightsSideDataReader = { read: () => Promise.resolve(SIDE) };
const q: InsightsQuery = { orgId: ORG };

describe('BigQueryInsightsSource (T07)', () => {
  it('keeps the shared InsightsSource contract (same checks as the Postgres source)', async () => {
    const { bq } = fakeBigQuery({});
    await assertInsightsSourceContract(
      new BigQueryInsightsSource(bq, side, CFG),
      q,
    );
  });

  describe('tenant wall', () => {
    it('every query it can build filters on @org_id and reads only the modelled dataset', () => {
      const sql = buildQueries(CFG);
      expect(Object.keys(sql).length).toBeGreaterThan(0);
      for (const [name, text] of Object.entries(sql)) {
        expect({ name, ok: /\borg_id = @org_id\b/.test(text) }).toEqual({
          name,
          ok: true,
        });
        expect(text).not.toContain('expelly_raw');
        expect(text).toContain('`test-project.expelly_learning.');
      }
    });

    it('no SQL string anywhere in the source file lacks @org_id (catches a query added later)', () => {
      const file = readFileSync(
        join(__dirname, 'bigquery-insights.source.ts'),
        'utf8',
      );
      // every template literal that looks like SQL (comments and escaped backticks removed first)
      const code = file
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/.*$/gm, '')
        .replace(/\\`/g, 'ESC');
      const literals = [...code.matchAll(/`([^`]*)`/g)]
        .map((m) => m[1])
        .filter((t) => /\bSELECT\b/.test(t) && /\bFROM\b/.test(t));
      expect(literals.length).toBeGreaterThanOrEqual(2);
      for (const t of literals) expect(t).toContain('@org_id');
    });

    it('passes the workspace id as a typed query parameter, never in the SQL text', async () => {
      const { bq, calls } = fakeBigQuery({});
      await new BigQueryInsightsSource(bq, side, CFG).all({
        orgId: OTHER_ORG,
        offerId: 'offer-9',
        campaignIds: ['c1', 'c2'],
        from: new Date('2026-11-01T00:00:00Z'),
        to: new Date('2026-12-01T00:00:00Z'),
      });
      expect(calls.length).toBe(2);
      for (const c of calls) {
        expect(c.params.org_id).toBe(OTHER_ORG);
        expect(c.query).not.toContain(OTHER_ORG);
        expect(c.query).toContain('@org_id');
      }
      const main = calls.find((c) => c.query.includes('company_reach'))!;
      expect(main.params).toEqual({
        org_id: OTHER_ORG,
        offer_id: 'offer-9',
        campaign_ids: ['c1', 'c2'],
        from_ts: '2026-11-01T00:00:00.000Z',
        to_ts: '2026-12-01T00:00:00.000Z',
      });
      expect(main.query).not.toContain('offer-9');
    });

    it('treats an empty or NULL campaign list as "no campaign filter" (BigQuery turns an empty array parameter into NULL)', () => {
      const sql = buildQueries(CFG).companies;
      expect(sql).toContain('COALESCE(ARRAY_LENGTH(@campaign_ids), 0) = 0');
      expect(sql).not.toMatch(/[^(]ARRAY_LENGTH\(@campaign_ids\) = 0/);
    });

    it('sends empty filters as typed nulls / empty arrays, with a byte cap and the Mumbai location', async () => {
      const { bq, calls } = fakeBigQuery({});
      await new BigQueryInsightsSource(bq, side, CFG).all(q);
      const main = calls.find((c) => c.query.includes('company_reach'))!;
      expect(main.params).toMatchObject({
        offer_id: null,
        campaign_ids: [],
        from_ts: null,
        to_ts: null,
      });
      expect(main.types).toEqual({
        org_id: 'STRING',
        offer_id: 'STRING',
        campaign_ids: ['STRING'],
        from_ts: 'TIMESTAMP',
        to_ts: 'TIMESTAMP',
      });
      for (const c of calls) {
        expect(c.maximumBytesBilled).toBe('1000000');
        expect(c.location).toBe('asia-south1');
      }
    });
  });

  describe('same numbers as the Postgres source', () => {
    it('turns a company_reach row into the same company the Postgres mapping builds', () => {
      const senders = new Map([['sender-1', 'one@sender.test']]);
      const fromBq = toInsightCompany(
        companyRowFromBigQuery(FIXTURE[0], senders),
      );

      // the row the Postgres query would return for the same company
      const pgRow: CompanyRow = {
        company_key: 'a.example',
        first_sent: new Date('2026-11-03T05:00:00.000Z'),
        snap: {
          company_key: 'a.example',
          country: 'IN',
          region: 'Maharashtra',
          city: 'Pune',
          industry: 'saas',
          size_band: '11-50',
          primary_trigger: 'hiring',
          role_bucket: 'founder_owner',
          source: 'expelly',
          mail_provider: 'google',
          timezone: 'Asia/Kolkata',
          stars: 4,
        },
        lead_city: 'ignored',
        lead_region: null,
        lead_country: null,
        lead_mail_provider: null,
        lead_source: null,
        lead_title: null,
        sender_email: 'one@sender.test',
        subject: 'Quick question about {{company}}',
        template_subject: 'Quick question about {{company}}',
        variant_label: 'A',
        bounced: false,
        opened: true,
        replied: true,
        positive: true,
        qualified: true,
        booked: true,
        unsubscribed: false,
        first_reply_at: new Date('2026-11-03T17:00:00.000Z'),
        reply_step: 1,
      };
      expect(fromBq).toEqual(toInsightCompany(pgRow));
      expect(fromBq.factors.city).toBe('Pune'); // snapshot wins over the lead fallback
      expect(fromBq.factors.sender).toBe('one@sender.test');
      expect(fromBq.factors.personalised).toBe('personalised');
      expect(fromBq.hoursToFirstReply).toBe(12);
    });

    it('shows "unknown" (never a crash) for an old enrollment with no snapshot', () => {
      const c = toInsightCompany(companyRowFromBigQuery(FIXTURE[4], new Map()));
      expect(c.factors.city).toBe('unknown');
      expect(c.factors.trigger).toBe('unknown');
      expect(c.factors.stars).toBe('not_scored');
      expect(c.factors.sender).toBe('unknown');
      expect(c.factors.variant).toBe('no A/B test');
      expect(c.recipientTz).toBeNull();
    });

    it('counts companies, reached, replies and qualified like the contract expects', async () => {
      const { bq } = fakeBigQuery({});
      const d = await new BigQueryInsightsSource(bq, side, CFG).all(q);
      expect(d.totals).toMatchObject({
        sent: 6,
        reached: 5, // c.example bounced
        bounced: 1,
        replied: 2,
        positive: 1,
        qualified: 1,
        booked: 1,
        unsubscribed: 1,
        discovered: 3,
        eligible: 2,
      });
      const pune = d.buckets.city.find((b) => b.bucket === 'Pune');
      expect(pune).toMatchObject({ reached: 2, replied: 1, qualified: 1 });
      // sequence step: where replies came from
      expect(d.buckets.sequence_step.map((b) => b.bucket)).toEqual([
        'step 1',
        'step 2',
      ]);
    });

    it('the factor funnel and send-time grid methods agree with all()', async () => {
      const { bq } = fakeBigQuery({});
      const src = new BigQueryInsightsSource(bq, side, CFG);
      const all = await src.all(q);
      expect(await src.factorFunnel(q, 'industry')).toEqual(
        all.buckets.industry,
      );
      expect(await src.sendTimeGrid(q)).toEqual(all.grid);
    });
  });

  describe('data as of', () => {
    it('is the newest change that reached BigQuery', async () => {
      const { bq } = fakeBigQuery({
        freshness: [{ last_change: { value: '2026-11-21T09:30:00.000Z' } }],
      });
      const d = await new BigQueryInsightsSource(bq, side, CFG).all(q);
      expect(d.dataAsOf?.toISOString()).toBe('2026-11-21T09:30:00.000Z');
    });

    it('is null when nothing has been replicated for this workspace yet', async () => {
      const { bq } = fakeBigQuery({ rows: [], freshness: [] });
      const d = await new BigQueryInsightsSource(bq, side, CFG).all(q);
      expect(d.dataAsOf).toBeNull();
      expect(d.totals.sent).toBe(0);
    });
  });
});

describe('FallbackInsightsSource (T07)', () => {
  const data = (name: string): InsightsData =>
    ({
      buckets: {},
      grid: [],
      totals: { sent: name === 'pg' ? 7 : 1 },
    }) as unknown as InsightsData;
  const source = (name: string, fail = false): InsightsSource => ({
    name,
    factorFunnel: () => Promise.resolve([]),
    sendTimeGrid: () => Promise.resolve([]),
    all: () =>
      fail ? Promise.reject(new Error('boom')) : Promise.resolve(data(name)),
  });

  it('uses BigQuery when it works', async () => {
    const s = new FallbackInsightsSource(
      source('bigquery'),
      source('postgres'),
    );
    const d = await s.all(q);
    expect(d.totals.sent).toBe(1);
    expect(d.source).toBeUndefined();
    expect(s.name).toBe('bigquery');
  });

  it('answers from Postgres, and says so, when BigQuery fails', async () => {
    const s = new FallbackInsightsSource(
      source('bigquery', true),
      source('pg'),
    );
    const d = await s.all(q);
    expect(d.totals.sent).toBe(7);
    expect(d.source).toBe('pg');
  });

  it('fails if both fail (never a silent empty page)', async () => {
    const s = new FallbackInsightsSource(
      source('bigquery', true),
      source('postgres', true),
    );
    await expect(s.all(q)).rejects.toThrow('boom');
  });

  it('the BigQuery source surfaces a client error instead of swallowing it', async () => {
    const { bq } = fakeBigQuery({ fail: true });
    await expect(
      new BigQueryInsightsSource(bq, side, CFG).all(q),
    ).rejects.toThrow('BigQuery is down');
  });
});
