/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-call */
import { getQueueToken } from '@nestjs/bullmq';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Queue } from 'bullmq';
import { randomUUID } from 'crypto';
import { Pool } from 'pg';
import request from 'supertest';
import { A2aClientService } from '../agents/a2a-client.service';
import { contractError } from '../agents/contracts';
import { startFakeAgent, type FakeAgent } from '../agents/fake-a2a-agent';
import { AiService } from '../ai/ai.service';
import { MemoryCircuitStore } from '../ai/router/circuit-breaker';
import { AppModule } from '../app.module';
import { PG_POOL } from '../db/db.module';
import { withOrgContext } from '../db/tenant-context';
import { PROSPECT_QUEUE } from '../queue/queue.module';
import { fetchPage as realFetchPage } from './web-reader';
import { AGENT_TOOL_TOKEN_VERIFIER } from './agent-tools.controller';
import {
  DiscoverRunCache,
  MAX_AGENT_FETCHES_PER_RUN,
} from './discover-run-cache';
import { ProspectsService } from './prospects.service';

jest.setTimeout(120_000);

const SA = 'discover-agent@test.iam.gserviceaccount.com';
const AUD = 'https://api.test.example';

/**
 * Learning Loop T10: the Discover agent driver. The agent is a fake A2A server (real HTTP, real
 * wire format); the agent's pages come from the API's own tool endpoint, exactly as in production.
 * Native stays the default: the existing prospects specs run unchanged.
 */
describe('Discover agent driver (T10)', () => {
  let app: INestApplication;
  let pool: Pool;
  let svc: ProspectsService;
  let ai: AiService;
  let cache: DiscoverRunCache;
  let queue: Queue;
  let token: string;
  let orgId: string;
  let userId: string;
  let otherOrgId: string;
  let otherUserId: string;
  let offerId: string;
  let fake: FakeAgent;
  /** What the fake agent does for the next request(s). */
  let behave: (req: any, call: (domain: string) => Promise<any>) => any;
  const http = () => request(app.getHttpServer());
  const q = <T>(
    fn: (c: Parameters<Parameters<typeof withOrgContext>[2]>[0]) => Promise<T>,
  ) => withOrgContext(pool, orgId, fn);

  const html = (domain: string, extra = '') =>
    `<html><head><title>${domain}</title></head><body>${'Acme builds freight software for logistics teams. '.repeat(10)} ${extra} Contact: owner@${domain}</body></html>`;

  const PAGES: Record<string, string> = {
    'a.test': html(
      'a.test',
      'Our office is in Pune. We are opening a second branch in Baner.',
    ),
    'b.test': html('b.test', 'Our office is in Pune.'),
    'c.test': html('c.test'),
    't1.test': html('t1.test', 'Our office is in Pune.'),
    'mumbai.test': html('mumbai.test', 'Our office is in Mumbai.'),
    'known.test': html('known.test'),
    'fb.test': html('fb.test'),
  };

  const stubWeb = () => {
    svc.io = {
      fetchPage: (url: string) => {
        const d = new URL(url).hostname.replace(/^www\./, '');
        if (url.endsWith('/robots.txt'))
          return Promise.resolve({ url, status: 404, html: '' });
        return PAGES[d]
          ? Promise.resolve({ url, status: 200, html: PAGES[d] })
          : Promise.reject(new Error('offline'));
      },
      hasMx: () => Promise.resolve(true),
    };
  };

  /** The agent's own tool call: through the real HTTP endpoint with the agent's identity. */
  const callTool = (runId: string) => async (domain: string) =>
    (
      await http()
        .post('/internal/agent-tools/fetch-pages')
        .set('Authorization', 'Bearer agent-token')
        .send({ orgId, runId, domain })
    ).body;

  const cand = (
    domain: string,
    over: Record<string, unknown> = {},
  ): Record<string, unknown> => ({
    name: domain.toUpperCase(),
    domain,
    companyKey: domain,
    isRealBusinessSite: true,
    summary: 'Freight software',
    evidence: [
      {
        fact: 'Builds freight software',
        quote: 'Acme builds freight software for logistics teams',
        url: `https://${domain}/`,
      },
    ],
    attributes: {
      city: 'Pune',
      country: 'India',
      industry: 'saas',
      size_band: '11-50',
    },
    triggers: [],
    emailsSeen: [],
    scores: { icp: 22, opportunity: 15, timing: 8, commercial: 9 },
    matchedPreference: false,
    ...over,
  });

  const output = (req: any, candidates: unknown[], stats: object = {}) => ({
    runId: req.runId,
    mode: req.mode,
    candidates,
    stats: {
      proposed: candidates.length,
      fetched: candidates.length,
      verified: candidates.length,
      droppedUnverified: 0,
      droppedSafety: 0,
      ...(req.preference
        ? {
            preferenceId: req.preference.id,
            preferenceRevision: req.preference.revision,
          }
        : {}),
      ...stats,
    },
  });

  beforeAll(async () => {
    process.env.THROTTLE_DISABLED = 'true';
    process.env.AGENT_TOOLS_AUDIENCE = AUD;
    process.env.AGENT_TOOLS_SA_EMAIL = SA;
    process.env.A2A_AUTH = 'none';
    fake = await startFakeAgent(async (call) => {
      const req = JSON.parse(call.text);
      return JSON.stringify(await behave(req, callTool(req.runId)));
    });
    process.env.DISCOVER_DRIVER = 'agent';
    process.env.DISCOVER_AGENT_URL = fake.url;

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(AGENT_TOOL_TOKEN_VERIFIER)
      .useValue({
        verify: (t: string) =>
          Promise.resolve(
            t === 'agent-token'
              ? { email: SA, emailVerified: true }
              : t === 'other-sa-token'
                ? { email: 'someone@else.com', emailVerified: true }
                : null,
          ),
      })
      .compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.init();
    pool = app.get<Pool>(PG_POOL);
    svc = app.get(ProspectsService);
    ai = app.get(AiService);
    cache = app.get(DiscoverRunCache);
    queue = app.get<Queue>(getQueueToken(PROSPECT_QUEUE));
    const a2a = app.get(A2aClientService);
    a2a.useCircuitStore(new MemoryCircuitStore());
    a2a.retryDelayMs = 0;

    const a = await http()
      .post('/auth/signup')
      .send({
        email: `t10-${randomUUID().slice(0, 8)}@test.local`,
        password: 't10-password-123',
        name: 'T10 Admin',
        orgName: 'T10 Org',
      })
      .expect(201);
    token = a.body.accessToken;
    orgId = a.body.org.id;
    userId = a.body.user.id;
    await q((c) =>
      c.query(`UPDATE orgs SET plan = 'internal' WHERE id = $1`, [orgId]),
    );
    const b = await http()
      .post('/auth/signup')
      .send({
        email: `t10-b-${randomUUID().slice(0, 8)}@test.local`,
        password: 't10-password-123',
        name: 'T10 Other',
        orgName: 'T10 Org B',
      })
      .expect(201);
    otherOrgId = b.body.org.id;
    otherUserId = b.body.user.id;
    offerId = await q(
      async (c) =>
        (
          await c.query<{ id: string }>(
            `INSERT INTO offers (org_id, name, description) VALUES ($1,'Missed-call follow-up','Callback in 30 seconds') RETURNING id`,
            [orgId],
          )
        ).rows[0].id,
    );
  });

  afterAll(async () => {
    jest.restoreAllMocks();
    delete process.env.THROTTLE_DISABLED;
    for (const k of [
      'AGENT_TOOLS_AUDIENCE',
      'AGENT_TOOLS_SA_EMAIL',
      'A2A_AUTH',
      'DISCOVER_DRIVER',
      'DISCOVER_AGENT_URL',
    ]) {
      delete process.env[k];
    }
    await fake.close();
    for (const o of [orgId, otherOrgId]) {
      await withOrgContext(pool, o, (c) =>
        c.query(`DELETE FROM orgs WHERE id = $1`, [o]),
      );
    }
    for (const u of [userId, otherUserId])
      await pool.query(`DELETE FROM users WHERE id = $1`, [u]);
    await app.close();
  });

  beforeEach(() => {
    jest.spyOn(queue, 'add').mockResolvedValue({} as never);
    stubWeb();
    fake.calls.length = 0;
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    await q(async (c) => {
      await c.query(`DELETE FROM prospect_runs`);
      await c.query(`DELETE FROM search_preferences`);
      await c.query(`DELETE FROM leads`);
    });
  });

  const start = (count = 3) =>
    svc.startRun(
      orgId,
      userId,
      'Find independent clinics in India',
      count,
      offerId,
    );

  // ── a run through the agent ─────────────────────────────────────────────

  it('an agent run is verified by the API: bad triggers and invented emails are dropped, the AI is not called, known companies are skipped', async () => {
    // a lead we already have: the request must say so, and the answer must not bring it back
    await q((c) =>
      c.query(
        `INSERT INTO leads (org_id, email, company_key) VALUES ($1,'x@known.test','known.test')`,
        [orgId],
      ),
    );
    const gen = jest.spyOn(ai, 'generate');
    behave = async (req, call) => {
      for (const d of ['a.test', 'b.test', 'c.test']) await call(d);
      return output(req, [
        cand('a.test', {
          triggers: [
            {
              type: 'expansion',
              quote: 'We are opening a second branch in Baner',
              url: 'https://a.test/',
            },
          ],
          // one address that IS on the page, one the model invented
          emailsSeen: [
            { email: 'owner@a.test', url: 'https://a.test/' },
            { email: 'ghost@a.test', url: 'https://a.test/' },
          ],
          matchedPreference: true,
        }),
        cand('b.test', {
          // a trigger quote that is not on the page
          triggers: [
            {
              type: 'funding',
              quote: 'We just raised a huge Series B round',
              url: 'https://b.test/',
            },
          ],
        }),
        cand('c.test', {
          // evidence that is not on the page: nothing backs this company up
          evidence: [
            {
              quote: 'A sentence that no page of this company contains',
              url: 'https://c.test/',
            },
          ],
        }),
        cand('known.test'),
      ]);
    };

    const run = await start(3);
    await svc.process(orgId, run.id);

    const rows = await q(
      async (c) =>
        (
          await c.query(
            `SELECT domain, status, triggers, city, emails, fit_score, attr_model, attr_prompt_version FROM prospects WHERE run_id = $1 ORDER BY domain`,
            [run.id],
          )
        ).rows,
    );
    expect(rows.map((r: any) => r.domain)).toEqual([
      'a.test',
      'b.test',
      'c.test',
    ]); // known.test never stored
    const [a, b, c] = rows;
    expect(a.status).toBe('verified');
    expect(a.triggers.map((t: any) => t.type)).toEqual(['expansion']);
    expect(a.city).toBe('Pune');
    expect(a.emails.map((e: any) => e.email)).toEqual(['owner@a.test']); // read from the page, never from the agent
    expect(a.fit_score).toBeGreaterThan(0);
    expect(a.attr_model).toBe('adk-discover');
    expect(a.attr_prompt_version).toBe('agent-discover@1');
    expect(b.status).toBe('verified');
    expect(b.triggers).toEqual([]); // the unverified trigger is dropped by code
    expect(c.status).toBe('rejected');

    // the typed request the agent got
    expect(fake.calls).toHaveLength(1);
    const req = JSON.parse(fake.calls[0].text);
    expect(contractError('discover.input', req)).toBeNull();
    expect(req).toMatchObject({
      runId: run.id,
      orgId,
      mode: 'baseline',
      targetCount: 3,
    });
    expect(req.offer.name).toBe('Missed-call follow-up');
    expect(req.excludeCompanyKeys).toContain('known.test');

    // the API's own AI was not used for planning or research
    expect(gen.mock.calls.map((x) => x[1])).not.toEqual(
      expect.arrayContaining(['prospect-icp']),
    );
    expect(gen.mock.calls.map((x) => x[1])).not.toContain('prospect-research');

    // the run header can show what the agent did
    const view = await svc.getRun(orgId, run.id);
    const steps = view.agent_steps.map((s: any) => s.text);
    expect(steps).toEqual(
      expect.arrayContaining([
        'Agent: planning the search and finding companies',
        'Agent: reading a.test',
      ]),
    );
    expect(
      steps.some((t: string) => /Agent returned 3 companies/.test(t)),
    ).toBe(true);
    expect(view.status).toBe('done');
  });

  it('a preference rides along in the request and the echo; the match is decided by code, never by the agent', async () => {
    await q((c) =>
      c.query(
        `INSERT INTO search_preferences (org_id, offer_id, factor, value, label, filter, cap_share,
            expires_at, evidence, evidence_hash, idempotency_key)
         VALUES ($1,$2,'city','Pune','City: Pune','{}'::jsonb,0.2, now() + interval '5 days',
                 '{}'::jsonb, $3, $3)`,
        [orgId, offerId, randomUUID()],
      ),
    );
    behave = async (req, call) => {
      if (req.mode === 'targeted') {
        for (const d of ['t1.test', 'mumbai.test']) await call(d);
        return output(req, [
          cand('t1.test', { matchedPreference: true }),
          // the agent CLAIMS this one matches; its own page says Mumbai
          cand('mumbai.test', {
            attributes: { city: 'Mumbai', country: 'India' },
            matchedPreference: true,
          }),
        ]);
      }
      const list = ['a.test', 'b.test', 'c.test'];
      for (const d of list) await call(d);
      return output(
        req,
        list.map((d) => cand(d)),
      );
    };

    const run = await start(10);
    expect(run.preference_id).toBeTruthy();
    await svc.process(orgId, run.id);

    // two typed calls: the normal search, then the targeted one with the preference
    expect(fake.calls).toHaveLength(2);
    const [base, targeted] = fake.calls.map((c) => JSON.parse(c.text));
    expect(base.mode).toBe('baseline');
    expect(base.preference).toBeUndefined();
    expect(base.targetCount).toBe(12); // 10 + the 2 reserved slots, for filling
    expect(targeted.mode).toBe('targeted');
    expect(targeted.preference).toEqual({
      id: run.preference_id,
      revision: 1,
      filter: { factor: 'city', value: 'Pune' },
    });
    expect(targeted.targetCount).toBe(4);
    for (const r of [base, targeted])
      expect(contractError('discover.input', r)).toBeNull();

    const marked = await q(
      async (c) =>
        (
          await c.query(
            `SELECT domain FROM prospects WHERE run_id = $1 AND via_preference ORDER BY domain`,
            [run.id],
          )
        ).rows,
    );
    // t1's page says Pune (verified); mumbai.test claimed a match but its page says Mumbai
    expect(marked.map((r: any) => r.domain)).toEqual(['t1.test']);
    const al = await q(
      async (c) =>
        (
          await c.query(`SELECT allocation FROM prospect_runs WHERE id = $1`, [
            run.id,
          ])
        ).rows[0].allocation,
    );
    expect(al).toMatchObject({
      cap: 2,
      targetedFound: 1,
      targetedKept: 1,
      finalized: true,
    });
  });

  it('if the agent cannot answer, the same run finishes with the standard search (one try, no retry)', async () => {
    behave = () => {
      throw new Error('agent crashed');
    };
    const out = (obj: unknown) =>
      Promise.resolve({
        text: JSON.stringify(obj),
        usage: { inputTokens: 1, outputTokens: 1 },
        model: 'mock',
        stopReason: 'end_turn',
      });
    const gen = jest
      .spyOn(ai, 'generate')
      .mockImplementation((_o: string, feature: string) =>
        feature === 'prospect-icp'
          ? out({
              icp: {
                summary: 'x',
                industries: [],
                regions: [],
                buyerRoles: [],
              },
              candidates: [{ name: 'FB', domain: 'fb.test', reason: 'fits' }],
            })
          : out({
              isRealBusinessSite: true,
              companyName: 'FB',
              summary: 's',
              industry: 'saas',
              facts: [
                {
                  fact: 'f',
                  quote: 'Acme builds freight software for logistics teams',
                  url: 'https://fb.test/',
                },
              ],
              scores: { icp: 20, opportunity: 15, timing: 5, commercial: 10 },
            }),
      );
    const run = await start(3);
    await svc.process(orgId, run.id);

    expect(fake.calls).toHaveLength(1); // not retried
    expect(gen.mock.calls.map((x) => x[1])).toEqual(
      expect.arrayContaining(['prospect-icp', 'prospect-research']),
    );
    const view = await svc.getRun(orgId, run.id);
    expect(view.status).toBe('done');
    expect(view.prospects.map((p: any) => [p.domain, p.status])).toEqual([
      ['fb.test', 'verified'],
    ]);
    expect(view.agent_steps.map((s: any) => s.text).join(' ')).toMatch(
      /could not answer/,
    );
  });

  it('an answer that breaks the contract is refused and the standard search runs instead', async () => {
    behave = (req: any) => ({ ...output(req, []), confidence: 0.99 }); // extra field: not the contract
    const gen = jest.spyOn(ai, 'generate').mockImplementation(() =>
      Promise.resolve({
        text: JSON.stringify({ icp: {}, candidates: [] }),
        usage: { inputTokens: 1, outputTokens: 1 },
        model: 'mock',
        stopReason: 'end_turn',
      }),
    );
    const run = await start(3);
    await svc.process(orgId, run.id);
    expect(gen.mock.calls.map((x) => x[1])).toContain('prospect-icp');
    expect((await svc.getRun(orgId, run.id)).status).toBe('done');
  });

  // ── the tool endpoint ───────────────────────────────────────────────────

  const toolRun = async () => {
    const run = await start(3);
    return run.id;
  };

  it('the fetch endpoint takes only the Discover agent identity (401 for everyone else)', async () => {
    const runId = await toolRun();
    const body = { orgId, runId, domain: 'a.test' };
    await http()
      .post('/internal/agent-tools/fetch-pages')
      .send(body)
      .expect(401);
    for (const bearer of ['forged', 'other-sa-token', token]) {
      await http()
        .post('/internal/agent-tools/fetch-pages')
        .set('Authorization', `Bearer ${bearer}`)
        .send(body)
        .expect(401);
    }
    const ok = await http()
      .post('/internal/agent-tools/fetch-pages')
      .set('Authorization', 'Bearer agent-token')
      .send(body)
      .expect(200);
    expect(ok.body.ok).toBe(true);
    expect(ok.body.pages[0].text).toContain('Acme builds freight software');
    expect(ok.body.pages[0].url).toMatch(/^https:\/\/a\.test\//);
  });

  it('the fetch endpoint is checked: unknown or other-workspace run, a finished run, bad input', async () => {
    const runId = await toolRun();
    const go = (b: object) =>
      http()
        .post('/internal/agent-tools/fetch-pages')
        .set('Authorization', 'Bearer agent-token')
        .send(b);
    await go({ orgId, runId: randomUUID(), domain: 'a.test' }).expect(404);
    await go({ orgId: otherOrgId, runId, domain: 'a.test' }).expect(404); // RLS: not that workspace's run
    await go({ orgId, runId, domain: 'localhost' }).expect(400); // not a website domain
    await go({ orgId: 'nope', runId, domain: 'a.test' }).expect(400);
    await q((c) =>
      c.query(`UPDATE prospect_runs SET status = 'done' WHERE id = $1`, [
        runId,
      ]),
    );
    const done = await go({ orgId, runId, domain: 'a.test' }).expect(409);
    expect(done.body.error).toBe('run_not_active');
  });

  it('the fetch endpoint refuses a private address, applies Model Armor, and limits each run', async () => {
    const runId = await toolRun();
    const go = (domain: string) =>
      http()
        .post('/internal/agent-tools/fetch-pages')
        .set('Authorization', 'Bearer agent-token')
        .send({ orgId, runId, domain });

    // SSRF: the real fetcher (not the test stub) never connects to a private address
    svc.io = {
      fetchPage: realFetchPage,
      hasMx: () => Promise.resolve(false),
    };
    const priv = await go('10.0.0.5').expect(200);
    expect(priv.body).toMatchObject({
      ok: false,
      reason: 'unreachable',
      pages: [],
    });
    stubWeb();

    // Model Armor says the page is a prompt injection: it never reaches the agent
    (svc as any).safety = {
      name: 'fake',
      screenInput: () =>
        Promise.resolve({
          verdict: 'blocked',
          findings: [{ filter: 'pi_and_jailbreak' }],
          provider: 'fake',
        }),
      screenOutput: () =>
        Promise.resolve({ verdict: 'ok', findings: [], provider: 'fake' }),
    };
    const blocked = await go('a.test').expect(200);
    expect(blocked.body).toMatchObject({
      ok: false,
      reason: 'safety_blocked',
      pages: [],
    });
    (svc as any).safety = undefined;

    // the per-run limit
    for (let i = 0; i < MAX_AGENT_FETCHES_PER_RUN; i++)
      await cache.countFetch(runId);
    const limited = await go('a.test').expect(429);
    expect(limited.body.error).toBe('run_limit');
  });
});
