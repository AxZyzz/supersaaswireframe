import { readFileSync } from 'fs';
import { join } from 'path';
import { BigQuery } from '@google-cloud/bigquery';
import { ConfigService } from '@nestjs/config';
import type { BigQueryRunner } from '../insights/bigquery-insights.source';
import {
  assertVector,
  GeminiEmbeddingProvider,
  MockEmbeddingProvider,
  tokens,
} from './embedding.provider';
import {
  FallbackRetriever,
  KeywordRetriever,
  keywordScore,
  VectorRetriever,
  type PlaybookRetriever,
} from './playbook-retriever';
import {
  BigQueryPlaybookVectorStore,
  buildVectorQueries,
  NoopVectorStore,
} from './vector-store';

const ORG = '11111111-1111-1111-1111-111111111111';
const OFFER = '22222222-2222-2222-2222-222222222222';
const CFG = {
  project: 'test-project',
  dataset: 'expelly_memory',
  location: 'asia-south1',
  maxBytesBilled: 1_000_000,
};

const cosine = (a: number[], b: number[]) =>
  a.reduce((n, x, i) => n + x * b[i], 0);

describe('embeddings (T14)', () => {
  it('the mock gives the same vector every time, of unit length', async () => {
    const m = new MockEmbeddingProvider(32);
    const a = await m.embed('Pune hiring companies reply more');
    const b = await m.embed('Pune hiring companies reply more');
    expect(a).toEqual(b);
    expect(a).toHaveLength(32);
    expect(Math.sqrt(a.reduce((n, x) => n + x * x, 0))).toBeCloseTo(1, 6);
  });

  it('texts that share words are closer than texts that do not', async () => {
    const m = new MockEmbeddingProvider(128);
    const q = await m.embed('subject lines about hiring in Pune');
    const near = await m.embed('Pune hiring companies answer subject lines');
    const far = await m.embed('invoice reminders for accountants in Oslo');
    expect(cosine(q, near)).toBeGreaterThan(cosine(q, far));
  });

  it('tokenises letters and digits only, lower-cased', () => {
    expect(tokens('Hello, World! 2 of 25-30 "Q&A"')).toEqual([
      'hello',
      'world',
      'of',
      '25',
      '30',
    ]);
  });

  it('assertVector rejects a wrong length or a non-number', () => {
    expect(assertVector([1, 2, 3], 3)).toEqual([1, 2, 3]);
    expect(() => assertVector([1, 2], 3)).toThrow(/3 finite numbers/);
    expect(() => assertVector([1, NaN, 3], 3)).toThrow();
    expect(() => assertVector(undefined, 3)).toThrow();
  });

  describe('Gemini provider', () => {
    const make = (env: Record<string, string> = {}) =>
      new GeminiEmbeddingProvider({
        get: (k: string) => env[k],
      } as unknown as ConfigService);

    it('asks for the document or query task and 768 dimensions by default', async () => {
      const p = make();
      const calls: unknown[][] = [];
      p.useEmbedFn((text, task, dims, model) => {
        calls.push([text, task, dims, model]);
        return Promise.resolve(new Array(dims).fill(0.5));
      });
      const v = await p.embed('  a lesson  ', 'RETRIEVAL_DOCUMENT');
      expect(v).toHaveLength(768);
      expect(calls[0]).toEqual([
        'a lesson',
        'RETRIEVAL_DOCUMENT',
        768,
        'gemini-embedding-001',
      ]);
      await p.embed('a goal', 'RETRIEVAL_QUERY');
      expect(calls[1][1]).toBe('RETRIEVAL_QUERY');
    });

    it('rejects an answer of the wrong size and empty text', async () => {
      const p = make({ EMBEDDING_DIMS: '256' });
      p.useEmbedFn(() => Promise.resolve([1, 2, 3]));
      await expect(p.embed('x y', 'RETRIEVAL_QUERY')).rejects.toThrow(
        /256 finite numbers/,
      );
      await expect(p.embed('   ', 'RETRIEVAL_QUERY')).rejects.toThrow(
        /nothing to embed/,
      );
    });

    it('explains what to set when neither a key nor Vertex is configured', async () => {
      await expect(make().embed('x y', 'RETRIEVAL_QUERY')).rejects.toThrow(
        /GEMINI_API_KEY/,
      );
      await expect(
        make({ EMBEDDINGS_USE_VERTEX: 'true' }).embed('x y', 'RETRIEVAL_QUERY'),
      ).rejects.toThrow(/GOOGLE_CLOUD_PROJECT/);
    });
  });
});

interface Call {
  query: string;
  params: Record<string, unknown>;
  types: Record<string, unknown>;
  location: string;
  maximumBytesBilled: string;
}
function fakeBq(rows: Array<Record<string, unknown>> = [], fail = false) {
  const calls: Call[] = [];
  const bq: BigQueryRunner = {
    query: (o) => {
      calls.push(o);
      return fail
        ? Promise.reject(new Error('BigQuery is down'))
        : Promise.resolve([rows]);
    },
  };
  return { bq, calls };
}

describe('BigQuery vector store (T14)', () => {
  it('every statement it can build names the workspace with @org_id and touches only playbook_vectors', () => {
    const sql = buildVectorQueries(CFG, 3);
    expect(Object.keys(sql).sort()).toEqual(['remove', 'search', 'upsert']);
    for (const [name, text] of Object.entries(sql)) {
      expect({ name, ok: /org_id\s*=\s*@org_id|@org_id,/.test(text) }).toEqual({
        name,
        ok: true,
      });
      expect(text).toContain('`test-project.expelly_memory.playbook_vectors`');
      expect(text).not.toContain('expelly_raw');
      expect(text).not.toContain('expelly_learning');
    }
  });

  it('no SQL string anywhere in the file lacks @org_id (catches a statement added later)', () => {
    const file = readFileSync(join(__dirname, 'vector-store.ts'), 'utf8');
    const code = file
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '')
      .replace(/\\`/g, 'ESC');
    const literals = [...code.matchAll(/`([^`]*)`/g)]
      .map((m) => m[1])
      .filter((t) => /\b(SELECT|DELETE|INSERT)\b/.test(t));
    expect(literals.length).toBeGreaterThanOrEqual(3);
    for (const t of literals) expect(t).toContain('@org_id');
  });

  it('the search pre-filters on workspace, offer and expiry before it ranks, and uses cosine distance', () => {
    const { search } = buildVectorQueries(CFG, 3);
    expect(search).toContain('VECTOR_SEARCH(');
    expect(search).toMatch(
      /WHERE org_id = @org_id AND offer_id = @offer_id AND valid_to > CURRENT_TIMESTAMP\(\)/,
    );
    expect(search).toContain("distance_type => 'COSINE'");
    expect(search).toContain('top_k => 3');
  });

  it('refuses a top-k that is not a small whole number (the one value that goes into the SQL text)', () => {
    for (const k of [0, -1, 2.5, 11, NaN]) {
      expect(() => buildVectorQueries(CFG, k)).toThrow(/top-k/);
    }
  });

  it('upserts with typed parameters, a byte cap and the Mumbai location', async () => {
    const { bq, calls } = fakeBq();
    await new BigQueryPlaybookVectorStore(bq, CFG).upsert({
      orgId: ORG,
      playbookId: 'pb-1',
      version: 2,
      offerId: OFFER,
      embedding: [0.1, 0.2],
      validTo: new Date('2027-01-01T00:00:00Z'),
    });
    expect(calls).toHaveLength(1);
    expect(calls[0].params).toEqual({
      org_id: ORG,
      playbook_id: 'pb-1',
      version: 2,
      offer_id: OFFER,
      embedding: [0.1, 0.2],
      valid_to: new Date('2027-01-01T00:00:00Z'),
    });
    expect(calls[0].types).toEqual({
      org_id: 'STRING',
      playbook_id: 'STRING',
      version: 'INT64',
      offer_id: 'STRING',
      embedding: ['FLOAT64'],
      valid_to: 'TIMESTAMP',
    });
    expect(calls[0].query).not.toContain(ORG); // never in the SQL text
    expect(calls[0].maximumBytesBilled).toBe('1000000');
    expect(calls[0].location).toBe('asia-south1');
  });

  it('every upsert parameter survives the real client conversion (a TIMESTAMP given as a string became NULL)', async () => {
    const { bq, calls } = fakeBq();
    await new BigQueryPlaybookVectorStore(bq, CFG).upsert({
      orgId: ORG,
      playbookId: 'pb-1',
      version: 2,
      offerId: OFFER,
      embedding: [0.1, 0.2],
      validTo: new Date('2027-01-01T00:00:00Z'),
    });
    const { params, types } = calls[0];
    type TypeHint = Parameters<typeof BigQuery.valueToQueryParameter_>[1];
    for (const [name, value] of Object.entries(params)) {
      const p = BigQuery.valueToQueryParameter_(value, types[name] as TypeHint);
      const sent = p.parameterValue?.arrayValues ?? p.parameterValue?.value;
      expect({ name, sent }).not.toEqual({ name, sent: null });
      expect({ name, sent }).not.toEqual({ name, sent: undefined });
    }
    expect(
      BigQuery.valueToQueryParameter_(
        params.valid_to,
        types.valid_to as TypeHint,
      ).parameterValue?.value,
    ).toBe('2027-01-01T00:00:00.000Z');
  });

  it('removes by workspace and id, and searches with the workspace and offer as parameters', async () => {
    const { bq, calls } = fakeBq([
      { playbook_id: 'b', distance: 0.4 },
      { playbook_id: 'a', distance: 0.1 },
    ]);
    const store = new BigQueryPlaybookVectorStore(bq, CFG);
    await store.remove(ORG, 'pb-1');
    expect(calls[0].params).toEqual({ org_id: ORG, playbook_id: 'pb-1' });
    const hits = await store.search({
      orgId: ORG,
      offerId: OFFER,
      embedding: [1, 0],
      k: 3,
    });
    expect(hits).toEqual([
      { playbookId: 'b', distance: 0.4 },
      { playbookId: 'a', distance: 0.1 },
    ]);
    expect(calls[1].params).toEqual({
      org_id: ORG,
      offer_id: OFFER,
      query_embedding: [1, 0],
    });
  });

  it('the no-op store (PLAYBOOK_SEARCH=postgres) finds nothing and does nothing', async () => {
    const n = new NoopVectorStore();
    await expect(n.upsert()).resolves.toBeUndefined();
    await expect(n.search()).resolves.toEqual([]);
  });
});

describe('retrieval (T14)', () => {
  const docs = [
    {
      id: 'pune',
      title: 'Find more: City: Pune',
      body: 'Pune companies hiring replied more.',
    },
    {
      id: 'subject',
      title: 'Winning subject for Demo',
      body: 'A short question as the subject beat a long one.',
    },
    { id: 'other', title: 'Invoices', body: 'Accountants answer in March.' },
  ];

  it('keyword score counts title words double and ignores filler words', () => {
    expect(keywordScore('the Pune hiring', docs[0])).toBe(2 + 1); // pune (title) + hiring (body)
    expect(keywordScore('the and of', docs[0])).toBe(0);
    expect(keywordScore('', docs[0])).toBe(0);
  });

  it('the keyword retriever returns the best matches first and drops zero scores', async () => {
    const r = new KeywordRetriever(() => Promise.resolve(docs));
    expect(
      await r.retrieve({
        orgId: ORG,
        offerId: OFFER,
        text: 'subject question Pune',
        k: 3,
      }),
    ).toEqual(['subject', 'pune']); // subject: 2 (title) + 1 (body) = 3, pune: 2
    expect(
      await r.retrieve({ orgId: ORG, offerId: OFFER, text: 'zebra', k: 3 }),
    ).toEqual([]);
    expect(
      await r.retrieve({
        orgId: ORG,
        offerId: OFFER,
        text: 'subject Pune',
        k: 1,
      }),
    ).toHaveLength(1);
  });

  it('the vector retriever embeds the request as a QUERY and keeps the store order', async () => {
    const emb = new MockEmbeddingProvider(16);
    const asked: string[] = [];
    const spy = {
      name: 'spy',
      dims: 16,
      embed: (t: string, task: string) => {
        asked.push(task);
        return emb.embed(t);
      },
    };
    const store = {
      name: 'fake',
      upsert: () => Promise.resolve(),
      remove: () => Promise.resolve(),
      search: () =>
        Promise.resolve([
          { playbookId: 'far', distance: 0.9 },
          { playbookId: 'near', distance: 0.1 },
        ]),
    };
    const r = new VectorRetriever(spy, store);
    expect(
      await r.retrieve({ orgId: ORG, offerId: OFFER, text: 'goal', k: 3 }),
    ).toEqual(['near', 'far']);
    expect(asked).toEqual(['RETRIEVAL_QUERY']);
    expect(
      await r.retrieve({ orgId: ORG, offerId: OFFER, text: '  ', k: 3 }),
    ).toEqual([]);
  });

  const failing: PlaybookRetriever = {
    name: 'bigquery',
    retrieve: () => Promise.reject(new Error('BigQuery is down')),
  };

  it('falls back to keywords when vector search fails', async () => {
    const kw = new KeywordRetriever(() => Promise.resolve(docs));
    const r = new FallbackRetriever(failing, kw);
    expect(
      await r.retrieve({
        orgId: ORG,
        offerId: OFFER,
        text: 'Pune hiring',
        k: 3,
      }),
    ).toEqual(['pune']);
  });

  it('folds in playbooks that have no vector yet, after the vector hits, without duplicates', async () => {
    const calls: boolean[] = [];
    const kw = new KeywordRetriever((_o, _f, opts) => {
      calls.push(opts.onlyUnindexed);
      return Promise.resolve(opts.onlyUnindexed ? [docs[0]] : docs);
    });
    const ok: PlaybookRetriever = {
      name: 'bigquery',
      retrieve: () => Promise.resolve(['subject', 'pune']),
    };
    const r = new FallbackRetriever(ok, kw);
    expect(
      await r.retrieve({
        orgId: ORG,
        offerId: OFFER,
        text: 'Pune hiring',
        k: 3,
      }),
    ).toEqual(['subject', 'pune']);
    expect(calls).toEqual([true]);
  });
});
