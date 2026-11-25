/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-call */
import { getQueueToken } from '@nestjs/bullmq';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Queue } from 'bullmq';
import { randomUUID } from 'crypto';
import { Pool } from 'pg';
import request from 'supertest';
import { AiService } from '../ai/ai.service';
import { AppModule } from '../app.module';
import { PG_POOL } from '../db/db.module';
import { withOrgContext } from '../db/tenant-context';
import { InsightsService } from '../insights/insights.service';
import { ProspectsService } from '../prospects/prospects.service';
import { PROSPECT_QUEUE } from '../queue/queue.module';
import { SearchPreferencesService } from './search-preferences.service';

jest.setTimeout(120_000);

/**
 * Learning Loop T12: search preferences. Insights, the AI and the network are
 * stubbed (they have their own tests); everything else is the real thing.
 */
describe('Search preferences (T12)', () => {
  let app: INestApplication;
  let pool: Pool;
  let prefs: SearchPreferencesService;
  let prospects: ProspectsService;
  let ai: AiService;
  let queue: Queue;
  let token: string;
  let managerToken: string;
  let agentToken: string;
  let otherToken: string;
  let orgId: string;
  let userId: string;
  let otherOrgId: string;
  let otherUserId: string;
  const extraUsers: string[] = [];
  let offerId: string;
  let stepId: string;
  let campaignId: string;

  const http = () => request(app.getHttpServer());
  const as = (t: string) => `Bearer ${t}`;
  const q = <T>(
    fn: (c: Parameters<Parameters<typeof withOrgContext>[2]>[0]) => Promise<T>,
  ) => withOrgContext(pool, orgId, fn);

  // ── stubs ───────────────────────────────────────────────────────────────

  /** The headlines the stubbed Insights page currently shows. */
  let headlines: Record<string, unknown>[] = [];
  const insight = (
    factor: string,
    bucket: string,
    x = 12,
    n = 200,
    searchable = true,
  ) => ({
    id: `${factor}:reply:${bucket}`,
    factor,
    factorLabel: factor,
    metric: 'reply',
    bucket,
    sentence: `${bucket} gets the most replies: ${x} of ${n} companies.`,
    x,
    n,
    p: x / n,
    lo: 0.04,
    hi: 0.09,
    overallP: 0.03,
    gap: 0.01,
    exploratory: 'Exploratory: not a decision.',
    confounding: null,
    searchable,
    diagnostic: false,
  });

  // ── builders ────────────────────────────────────────────────────────────

  const propose = (t: string, insightId: string, body: object = {}) =>
    http()
      .post('/search-preferences/propose')
      .set('Authorization', as(t))
      .send({ offerId, insightId, ...body });

  const create = (
    t: string,
    proposalHash: string,
    insightId: string,
    body: Record<string, unknown> = {},
  ) =>
    http()
      .post('/search-preferences')
      .set('Authorization', as(t))
      .send({
        offerId,
        insightId,
        proposalHash,
        idempotencyKey: randomUUID(),
        ...body,
      });

  /** Propose + approve in one go; returns the stored preference. */
  const approve = async (
    insightId: string,
    body: Record<string, unknown> = {},
    forOffer = offerId,
  ) => {
    const pr = await http()
      .post('/search-preferences/propose')
      .set('Authorization', as(token))
      .send({ offerId: forOffer, insightId })
      .expect(200);
    const res = await http()
      .post('/search-preferences')
      .set('Authorization', as(token))
      .send({
        offerId: forOffer,
        insightId,
        proposalHash: pr.body.proposalHash,
        idempotencyKey: randomUUID(),
        ...body,
      })
      .expect(200);
    return res.body as { id: string; status: string };
  };

  const mkOffer = (name: string) =>
    q(
      async (c) =>
        (
          await c.query<{ id: string }>(
            `INSERT INTO offers (org_id, name) VALUES ($1,$2) RETURNING id`,
            [orgId, name],
          )
        ).rows[0].id,
    );

  const page = (domain: string, city: string | null) =>
    Promise.resolve({
      url: `https://${domain}/`,
      status: 200,
      html: `<html><head><title>${domain}</title></head><body>${'Acme builds freight software for logistics teams. '.repeat(10)} ${city ? `Our office is in ${city}.` : ''} Contact: owner@${domain}</body></html>`,
    });

  /** Normal companies b1..b12, targeted t1 (in Pune), b1 (overlap), t3, t4. */
  const stubDiscover = (opts: { targetedFails?: boolean } = {}) => {
    // calls from earlier tests must not leak into this one
    jest.spyOn(ai, 'generate').mockClear();
    prospects.io = {
      fetchPage: (url: string) => {
        const domain = new URL(url).hostname.replace(/^www\./, '');
        if (url.endsWith('/robots.txt')) {
          return Promise.resolve({ url, status: 404, html: '' });
        }
        return page(domain, domain === 't1.test' ? 'Pune' : null);
      },
      hasMx: () => Promise.resolve(true),
    };
    const cand = (d: string) => ({
      name: d.toUpperCase(),
      domain: d,
      reason: 'fits',
    });
    const baseline = Array.from({ length: 12 }, (_, i) =>
      cand(`b${i + 1}.test`),
    );
    const targeted = ['t1.test', 'b1.test', 't3.test', 't4.test'].map(cand);
    return jest
      .spyOn(ai, 'generate')
      .mockImplementation((_org: string, feature: string, o: any) => {
        const out = (obj: unknown) =>
          Promise.resolve({
            text: JSON.stringify(obj),
            usage: { inputTokens: 1, outputTokens: 1 },
            model: 'mock',
            stopReason: 'end_turn',
          });
        if (feature === 'prospect-icp') {
          return out({
            icp: {
              summary: 'logistics software',
              industries: [],
              regions: [],
              buyerRoles: [],
            },
            candidates: baseline,
          });
        }
        if (feature === 'prospect-targeted') {
          if (opts.targetedFails) {
            return Promise.reject(new Error('model unavailable'));
          }
          return out({ candidates: targeted });
        }
        // prospect-research: the AI claims Pune for everyone; only the page of
        // t1.test actually says so, so only t1 is verified as Pune
        const domain = /Company domain: (\S+)/.exec(
          o.messages[0].content as string,
        )![1];
        return out({
          isRealBusinessSite: true,
          companyName: domain,
          summary: 'Freight software',
          industry: 'saas',
          city: 'Pune',
          country: 'India',
          facts: [
            {
              fact: 'Builds freight software',
              quote: 'Acme builds freight software for logistics teams',
              url: `https://${domain}/`,
            },
          ],
          scores: { icp: 20, opportunity: 15, timing: 5, commercial: 10 },
        });
      });
  };

  /** Bulk companies for the results tests: sent step 1, with outcomes. */
  const bulkCompanies = async (p: {
    runId: string;
    prefId: string | null;
    count: number;
    qualified?: number;
    bounced?: number;
    daysAgo?: number;
    tag: string;
  }) => {
    await q(async (c) => {
      await c.query(
        `WITH l AS (
           INSERT INTO leads (org_id, email, company_key)
           SELECT $1, 'p@' || $2 || g || '.test', $2 || g || '.test'
             FROM generate_series(1, $3::int) g RETURNING id, company_key
         ), cl AS (
           INSERT INTO campaign_leads (org_id, campaign_id, lead_id, status, current_step, snapshot)
           SELECT $1, $4, l.id, 'active', 1,
                  jsonb_build_object('company_key', l.company_key,
                                     'discovery_run_id', $5::text,
                                     'preference_id', $6::text)
             FROM l RETURNING id, lead_id
         )
         INSERT INTO sent_emails (org_id, campaign_id, campaign_lead_id, lead_id, step_id,
                                  to_email, subject, status, sent_at)
         SELECT $1, $4, cl.id, cl.lead_id, $7, 'p@x.test', 's', 'sent',
                now() - make_interval(days => $8::int)
           FROM cl`,
        [
          orgId,
          p.tag,
          p.count,
          campaignId,
          p.runId,
          p.prefId,
          stepId,
          p.daysAgo ?? 30,
        ],
      );
      const outcome = async (type: string, verification: string, k: number) => {
        if (!k) return;
        await c.query(
          `INSERT INTO outcome_events
             (org_id, campaign_lead_id, lead_id, company_key, type, source, verification,
              occurred_at, idempotency_key)
           SELECT $1, t.id, t.lead_id, t.company_key, $2, 'manual', $3,
                  now() - interval '25 days', gen_random_uuid()::text
             FROM (SELECT cl.id, cl.lead_id, l.company_key,
                          row_number() OVER (ORDER BY l.company_key) AS rn
                     FROM campaign_leads cl JOIN leads l ON l.id = cl.lead_id
                    WHERE cl.snapshot->>'discovery_run_id' = $4
                      AND COALESCE(cl.snapshot->>'preference_id', '') = COALESCE($5, '')
                      AND l.company_key LIKE $6) t
            WHERE t.rn <= $7`,
          [orgId, type, verification, p.runId, p.prefId, `${p.tag}%`, k],
        );
      };
      await outcome('bounce', 'verified', p.bounced ?? 0);
      await outcome('qualified_reply', 'verified', p.qualified ?? 0);
    });
  };

  const mkRun = (prefId: string | null, requested = 10, status = 'done') =>
    q(
      async (c) =>
        (
          await c.query<{ id: string }>(
            `INSERT INTO prospect_runs (org_id, goal, status, requested, offer_id, preference_id, preference_revision)
             VALUES ($1,'Find clinics','${status}',$2,$3,$4, CASE WHEN $4::uuid IS NULL THEN NULL ELSE 1 END)
             RETURNING id`,
            [orgId, requested, offerId, prefId],
          )
        ).rows[0].id,
    );

  const startRun = (count = 10, forOffer = offerId) =>
    prospects.startRun(
      orgId,
      userId,
      'Find independent clinics in India',
      count,
      forOffer,
    );

  beforeAll(async () => {
    process.env.THROTTLE_DISABLED = 'true';
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
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
    prefs = app.get(SearchPreferencesService);
    prospects = app.get(ProspectsService);
    ai = app.get(AiService);
    queue = app.get<Queue>(getQueueToken(PROSPECT_QUEUE));

    // Insights is tested elsewhere: show whatever headlines the test sets
    jest.spyOn(app.get(InsightsService), 'get').mockImplementation(() =>
      Promise.resolve({
        source: 'postgres',
        generatedAt: new Date().toISOString(),
        cached: false,
        filters: { offerId: null, campaignIds: [], from: null, to: null },
        headlinesByMetric: { reply: headlines, qualified: [] },
      } as never),
    );

    const a = await http()
      .post('/auth/signup')
      .send({
        email: `t12-a-${randomUUID().slice(0, 8)}@test.local`,
        password: 't12-password-123',
        name: 'T12 Admin',
        orgName: 'T12 Org A',
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
        email: `t12-b-${randomUUID().slice(0, 8)}@test.local`,
        password: 't12-password-123',
        name: 'T12 Other',
        orgName: 'T12 Org B',
      })
      .expect(201);
    otherToken = b.body.accessToken;
    otherOrgId = b.body.org.id;
    otherUserId = b.body.user.id;
    for (const role of ['manager', 'agent'] as const) {
      const inv = await http()
        .post('/orgs/invites')
        .set('Authorization', as(token))
        .send({
          email: `t12-${role}-${randomUUID().slice(0, 8)}@test.local`,
          role,
        })
        .expect(201);
      const reg = await http()
        .post(`/invites/${inv.body.token}/register`)
        .send({ name: `T12 ${role}`, password: 'invitee-pass-123' })
        .expect(201);
      extraUsers.push(reg.body.user.id);
      if (role === 'manager') managerToken = reg.body.accessToken;
      else agentToken = reg.body.accessToken;
    }

    offerId = await mkOffer('Missed-call follow-up');
    await q(async (c) => {
      const camp = await c.query<{ id: string }>(
        `INSERT INTO campaigns (org_id, name, status, offer_id) VALUES ($1,'T12 results','active',$2) RETURNING id`,
        [orgId, offerId],
      );
      campaignId = camp.rows[0].id;
      const st = await c.query<{ id: string }>(
        `INSERT INTO campaign_steps (org_id, campaign_id, step_order, delay_hours)
         VALUES ($1,$2,1,0) RETURNING id`,
        [orgId, campaignId],
      );
      stepId = st.rows[0].id;
    });
  });

  afterAll(async () => {
    jest.restoreAllMocks();
    delete process.env.THROTTLE_DISABLED;
    for (const o of [orgId, otherOrgId]) {
      await withOrgContext(pool, o, (c) =>
        c.query(`DELETE FROM orgs WHERE id = $1`, [o]),
      );
    }
    for (const u of [userId, otherUserId, ...extraUsers]) {
      await pool.query(`DELETE FROM users WHERE id = $1`, [u]);
    }
    await app.close();
  });

  afterEach(async () => {
    jest.spyOn(queue, 'add').mockResolvedValue({} as never);
    headlines = [];
    await q(async (c) => {
      await c.query(`DELETE FROM prospect_runs`);
      await c.query(`DELETE FROM search_preferences`);
      await c.query(`DELETE FROM notifications`);
    });
  });

  beforeEach(() => {
    jest.spyOn(queue, 'add').mockResolvedValue({} as never);
    headlines = [
      insight('city', 'Pune'),
      insight('trigger', 'expansion', 9, 150),
    ];
  });

  // ── proposing and approving ─────────────────────────────────────────────

  it('propose shows the exact filter, the 20% cap, the 14-day expiry and the evidence, and saves nothing', async () => {
    const res = await propose(token, 'city:reply:Pune').expect(200);
    expect(res.body.filter).toEqual({ factor: 'city', value: 'Pune' });
    expect(res.body.capShare).toBe(0.2);
    expect(res.body.expiresInDays).toBe(14);
    expect(res.body.example).toEqual({ batch12: 2, batch20: 4 });
    expect(res.body.evidence).toMatchObject({ x: 12, n: 200, metric: 'reply' });
    expect(res.body.staysTheSame.length).toBeGreaterThan(0);
    expect(res.body.weakMatch).toBe(false);
    const rows = await q((c) => c.query(`SELECT 1 FROM search_preferences`));
    expect(rows.rowCount).toBe(0);
    // industry is the model's reading of the site: a weaker match, said so
    headlines = [insight('industry', 'saas')];
    const weak = await propose(token, 'industry:reply:saas').expect(200);
    expect(weak.body.weakMatch).toBe(true);
    // an insight that is no longer a headline, or not searchable
    await propose(token, 'city:reply:Delhi').expect(409);
    headlines = [insight('role', 'manager', 12, 200, false)];
    await propose(token, 'role:reply:manager').expect(409);
  });

  it('approving creates one active, capped, expiring preference with an audit row', async () => {
    const pr = await propose(token, 'city:reply:Pune').expect(200);
    const res = await create(
      managerToken,
      pr.body.proposalHash,
      'city:reply:Pune',
    ).expect(200);
    expect(res.body).toMatchObject({
      status: 'active',
      factor: 'city',
      value: 'Pune',
      capShare: 0.2,
      mode: 'quota',
      revision: 1,
    });
    expect(res.body.approvedBy.name).toBe('T12 manager');
    const days =
      (new Date(res.body.expiresAt).getTime() - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(13.9);
    expect(days).toBeLessThanOrEqual(14);
    const rev = await q((c) =>
      c.query(
        `SELECT action FROM search_preference_revisions WHERE preference_id = $1`,
        [res.body.id],
      ),
    );
    expect(rev.rows).toEqual([{ action: 'created' }]);
  });

  it('a duplicate approval (same idempotency key) is one preference, same answer', async () => {
    const pr = await propose(token, 'city:reply:Pune').expect(200);
    const key = randomUUID();
    const send = () =>
      create(token, pr.body.proposalHash, 'city:reply:Pune', {
        idempotencyKey: key,
      });
    const first = await send().expect(200);
    const second = await send().expect(200);
    expect(second.body.id).toBe(first.body.id);
    expect(second.body.replayed).toBe(true);
    const n = await q((c) => c.query(`SELECT 1 FROM search_preferences`));
    expect(n.rowCount).toBe(1);
    // the same key for different evidence is refused, not replayed
    const other = await propose(token, 'trigger:reply:expansion').expect(200);
    const clash = await create(
      token,
      other.body.proposalHash,
      'trigger:reply:expansion',
      {
        idempotencyKey: key,
      },
    ).expect(409);
    expect(clash.body.error).toBe('idempotency_key_reused');
  });

  it('two parallel approvals (different keys) -> exactly one preference', async () => {
    const pr = await propose(token, 'city:reply:Pune').expect(200);
    const go = () => create(token, pr.body.proposalHash, 'city:reply:Pune');
    const [a, b] = await Promise.all([go(), go()]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    const n = await q((c) => c.query(`SELECT 1 FROM search_preferences`));
    expect(n.rowCount).toBe(1);
  });

  it('a second active preference for the same offer -> 409 with a link; a different offer is allowed', async () => {
    const first = await approve('city:reply:Pune');
    const pr = await propose(token, 'trigger:reply:expansion').expect(200);
    expect(pr.body.warnings.map((w: { code: string }) => w.code)).toContain(
      'active_preference_exists',
    );
    const res = await create(
      token,
      pr.body.proposalHash,
      'trigger:reply:expansion',
    ).expect(409);
    expect(res.body.error).toBe('active_preference_exists');
    expect(res.body.preferenceId).toBe(first.id);

    const offer2 = await mkOffer('Another offer');
    const ok = await approve('trigger:reply:expansion', {}, offer2);
    expect(ok.status).toBe('active');
  });

  it('cap above 20% and expiry above 30 days are refused', async () => {
    const pr = await propose(token, 'city:reply:Pune').expect(200);
    const cap = await create(token, pr.body.proposalHash, 'city:reply:Pune', {
      capShare: 0.5,
    }).expect(400);
    expect(cap.body.error).toBe('cap_too_high');
    const exp = await create(token, pr.body.proposalHash, 'city:reply:Pune', {
      expiresInDays: 31,
    }).expect(400);
    expect(exp.body.error).toBe('expiry_out_of_range');
    // a smaller cap and a shorter test are fine
    const ok = await create(token, pr.body.proposalHash, 'city:reply:Pune', {
      capShare: 0.1,
      expiresInDays: 7,
    }).expect(200);
    expect(ok.body.capShare).toBe(0.1);
  });

  it('the same evidence cannot approve a second test, even after the first ended; fresh results can', async () => {
    const first = await approve('city:reply:Pune');
    await http()
      .post(`/search-preferences/${first.id}/withdraw`)
      .set('Authorization', as(token))
      .send({ reason: 'trying something else' })
      .expect(200);
    const pr = await propose(token, 'city:reply:Pune').expect(200);
    expect(pr.body.warnings.map((w: { code: string }) => w.code)).toContain(
      'same_evidence',
    );
    const res = await create(
      token,
      pr.body.proposalHash,
      'city:reply:Pune',
    ).expect(409);
    expect(res.body.error).toBe('same_evidence');
    expect(res.body.message).toMatch(/re-test the same data/);
    // fresh results (the numbers moved) are a new piece of evidence
    headlines = [insight('city', 'Pune', 20, 300)];
    const fresh = await propose(token, 'city:reply:Pune').expect(200);
    await create(token, fresh.body.proposalHash, 'city:reply:Pune').expect(200);
  });

  it('numbers that changed since the preview -> 409 proposal_changed', async () => {
    const pr = await propose(token, 'city:reply:Pune').expect(200);
    headlines = [insight('city', 'Pune', 15, 210)];
    const res = await create(
      token,
      pr.body.proposalHash,
      'city:reply:Pune',
    ).expect(409);
    expect(res.body.error).toBe('proposal_changed');
  });

  it('agent cannot propose, approve, withdraw or revert (403); everyone can read; other workspace gets 404', async () => {
    const pref = await approve('city:reply:Pune');
    await propose(agentToken, 'city:reply:Pune').expect(403);
    await create(agentToken, 'x'.repeat(20), 'city:reply:Pune').expect(403);
    for (const verb of ['withdraw', 'revert']) {
      await http()
        .post(`/search-preferences/${pref.id}/${verb}`)
        .set('Authorization', as(agentToken))
        .send({})
        .expect(403);
    }
    const list = await http()
      .get('/search-preferences')
      .set('Authorization', as(agentToken))
      .expect(200);
    expect(list.body).toHaveLength(1);
    await http()
      .get(`/search-preferences/${pref.id}`)
      .set('Authorization', as(agentToken))
      .expect(200);
    await http()
      .get(`/search-preferences/${pref.id}/results`)
      .set('Authorization', as(agentToken))
      .expect(200);

    // another workspace
    await http()
      .get(`/search-preferences/${pref.id}`)
      .set('Authorization', as(otherToken))
      .expect(404);
    await http()
      .get(`/search-preferences/${pref.id}/results`)
      .set('Authorization', as(otherToken))
      .expect(404);
    await http()
      .post(`/search-preferences/${pref.id}/withdraw`)
      .set('Authorization', as(otherToken))
      .send({})
      .expect(404);
    const otherList = await http()
      .get('/search-preferences')
      .set('Authorization', as(otherToken))
      .expect(200);
    expect(otherList.body).toHaveLength(0);
  });

  // ── lifecycle ───────────────────────────────────────────────────────────

  it('withdraw is instant, keeps a full history, and cannot be done twice; revert records the no-op restore', async () => {
    const a = await approve('city:reply:Pune');
    const w = await http()
      .post(`/search-preferences/${a.id}/withdraw`)
      .set('Authorization', as(managerToken))
      .send({ reason: 'not now' })
      .expect(200);
    expect(w.body).toMatchObject({
      status: 'withdrawn',
      endedReason: 'not now',
      revision: 2,
    });
    await http()
      .post(`/search-preferences/${a.id}/withdraw`)
      .set('Authorization', as(token))
      .send({})
      .expect(409);

    headlines = [insight('trigger', 'expansion', 9, 150)];
    const b = await approve('trigger:reply:expansion');
    const r = await http()
      .post(`/search-preferences/${b.id}/revert`)
      .set('Authorization', as(token))
      .send({ reason: 'bounces' })
      .expect(200);
    expect(r.body.status).toBe('reverted');
    const detail = await http()
      .get(`/search-preferences/${b.id}`)
      .set('Authorization', as(token))
      .expect(200);
    expect(
      detail.body.revisions.map((x: { action: string }) => x.action),
    ).toEqual(['created', 'reverted']);
    expect(detail.body.revisions[1].after.priorProfileRestored).toBe(false);
  });

  it('expiry flips an overdue preference once, even when two instances run it at the same time', async () => {
    const a = await approve('city:reply:Pune');
    await q((c) =>
      c.query(
        `UPDATE search_preferences SET expires_at = now() - interval '1 minute' WHERE id = $1`,
        [a.id],
      ),
    );
    const [x, y] = await Promise.all([prefs.expireDue(), prefs.expireDue()]);
    expect(x + y).toBe(1);
    const row = await q(
      async (c) =>
        (
          await c.query(
            `SELECT status, ended_reason, revision FROM search_preferences WHERE id = $1`,
            [a.id],
          )
        ).rows[0],
    );
    expect(row).toEqual({
      status: 'expired',
      ended_reason: 'Reached its expiry date',
      revision: 2,
    });
    const rev = await q((c) =>
      c.query(
        `SELECT 1 FROM search_preference_revisions WHERE preference_id = $1 AND action = 'expired'`,
        [a.id],
      ),
    );
    expect(rev.rowCount).toBe(1);
    // the team is told once, and a repeat pass does nothing
    expect(await prefs.expireDue()).toBe(0);
    const n = await q((c) =>
      c.query(`SELECT 1 FROM notifications WHERE type = 'search_preference'`),
    );
    expect(n.rowCount).toBeGreaterThan(0);
    // a new run after expiry is not pinned
    const run = await startRun();
    expect(run.preference_id).toBeNull();
  });

  it('an overdue preference the timer has not flipped yet does not block approving a new one', async () => {
    const a = await approve('city:reply:Pune');
    await q((c) =>
      c.query(
        `UPDATE search_preferences SET expires_at = now() - interval '1 minute' WHERE id = $1`,
        [a.id],
      ),
    );
    headlines = [insight('trigger', 'expansion', 9, 150)];
    const b = await approve('trigger:reply:expansion');
    expect(b.status).toBe('active');
    const old = await q(
      async (c) =>
        (
          await c.query(`SELECT status FROM search_preferences WHERE id = $1`, [
            a.id,
          ])
        ).rows[0].status,
    );
    expect(old).toBe('expired');
  });

  it('switches itself off when the targeted leads bounce too much, with a reason and a notification', async () => {
    const a = await approve('city:reply:Pune');
    const runId = await mkRun(a.id);
    // 40 targeted companies, 6 bounced (15%); 40 baseline companies, none
    await bulkCompanies({
      runId,
      prefId: a.id,
      count: 40,
      bounced: 6,
      tag: 'tg',
    });
    await bulkCompanies({ runId, prefId: null, count: 40, tag: 'bs' });
    expect(await prefs.checkGuardrails()).toBe(1);
    const row = await q(
      async (c) =>
        (
          await c.query(
            `SELECT status, ended_reason FROM search_preferences WHERE id = $1`,
            [a.id],
          )
        ).rows[0],
    );
    expect(row.status).toBe('deactivated');
    expect(row.ended_reason).toMatch(/bounced 15\.0%/);
    const n = await q((c) =>
      c.query(
        `SELECT title FROM notifications WHERE type = 'search_preference' LIMIT 1`,
      ),
    );
    expect(n.rows[0].title).toMatch(/switched off/i);
    // a healthy preference is left alone
    headlines = [insight('trigger', 'expansion', 9, 150)];
    await approve('trigger:reply:expansion');
    expect(await prefs.checkGuardrails()).toBe(0);
  });

  // ── Discover runs ───────────────────────────────────────────────────────

  it('a run reserves 20%: cap 2 of 10, targeted finds 1 so 1 is filled from the normal search; overlap counts once', async () => {
    stubDiscover();
    const a = await approve('city:reply:Pune');
    const run = await startRun(10);
    expect(run.preference_id).toBe(a.id);
    expect(run.preference_revision).toBe(1);
    await prospects.process(orgId, run.id);

    const done = await q(
      async (c) =>
        (
          await c.query(
            `SELECT status, total, allocation FROM prospect_runs WHERE id = $1`,
            [run.id],
          )
        ).rows[0],
    );
    expect(done.status).toBe('done');
    expect(done.allocation).toMatchObject({
      batchSize: 10,
      cap: 2,
      capShare: 0.2,
      factor: 'city',
      value: 'Pune',
      targetedRequested: 4,
      targetedFound: 1,
      targetedKept: 1,
      shortfall: 1,
      baselineFilled: 1,
      dedupedOverlap: 1,
      finalized: true,
    });
    expect(done.allocation.reserve).toBeUndefined();

    const rows = await q(
      async (c) =>
        (
          await c.query(
            `SELECT domain, via_preference FROM prospects WHERE run_id = $1 ORDER BY domain`,
            [run.id],
          )
        ).rows,
    );
    // 4 targeted + 8 normal + 1 fill; b1 is in both lists but only once in the run
    expect(rows).toHaveLength(13);
    expect(rows.filter((r: any) => r.domain === 'b1.test')).toHaveLength(1);
    expect(
      rows.filter((r: any) => r.via_preference).map((r: any) => r.domain),
    ).toEqual(['t1.test']);

    const view = await prospects.getRun(orgId, run.id);
    expect(view.allocation_line).toBe(
      '20% reserved for City: Pune: found 1 of 2, 1 filled from the normal search.',
    );
  });

  it('if the targeted search fails, the whole shortfall is filled from the normal search', async () => {
    stubDiscover({ targetedFails: true });
    await approve('city:reply:Pune');
    const run = await startRun(10);
    await prospects.process(orgId, run.id);
    const al = await q(
      async (c) =>
        (
          await c.query(`SELECT allocation FROM prospect_runs WHERE id = $1`, [
            run.id,
          ])
        ).rows[0].allocation,
    );
    expect(al).toMatchObject({
      targetedRequested: 0,
      targetedKept: 0,
      shortfall: 2,
      baselineFilled: 2,
    });
    const marked = await q((c) =>
      c.query(`SELECT 1 FROM prospects WHERE run_id = $1 AND via_preference`, [
        run.id,
      ]),
    );
    expect(marked.rowCount).toBe(0);
  });

  it('a batch too small to reserve a slot runs normally and says why', async () => {
    const gen = stubDiscover();
    await approve('city:reply:Pune');
    const run = await startRun(3);
    await prospects.process(orgId, run.id);
    const al = await q(
      async (c) =>
        (
          await c.query(`SELECT allocation FROM prospect_runs WHERE id = $1`, [
            run.id,
          ])
        ).rows[0].allocation,
    );
    expect(al.skipped).toMatch(/too small/);
    expect(gen.mock.calls.map((c) => c[1])).not.toContain('prospect-targeted');
    const view = await prospects.getRun(orgId, run.id);
    expect(view.allocation_line).toMatch(/^Preference not used/);
  });

  it('a run started before a withdraw keeps its pin; a run after it has no preference', async () => {
    stubDiscover();
    const a = await approve('city:reply:Pune');
    const before = await startRun(10);
    expect(before.preference_id).toBe(a.id);
    await http()
      .post(`/search-preferences/${a.id}/withdraw`)
      .set('Authorization', as(token))
      .send({})
      .expect(200);
    // the run that started earlier still uses it
    await prospects.process(orgId, before.id);
    const al = await q(
      async (c) =>
        (
          await c.query(`SELECT allocation FROM prospect_runs WHERE id = $1`, [
            before.id,
          ])
        ).rows[0].allocation,
    );
    expect(al).toMatchObject({ cap: 2, finalized: true });
    // a new run (the first one is done) is normal
    const after = await startRun(10);
    expect(after.preference_id).toBeNull();
    expect(after.preference_revision).toBeNull();
  });

  it('a lead that came in through the preference carries it into the enrollment snapshot; the rest do not', async () => {
    stubDiscover();
    const a = await approve('city:reply:Pune');
    const run = await startRun(10);
    await prospects.process(orgId, run.id);
    const ids = await q(
      async (c) =>
        (
          await c.query(
            `SELECT id, domain FROM prospects WHERE run_id = $1 AND domain IN ('t1.test','b2.test')`,
            [run.id],
          )
        ).rows,
    );
    const added = await prospects.addToLeads(
      orgId,
      ids.map((r: any) => r.id),
      'T12 segment',
    );
    expect(added.added).toBe(2);

    const tpls = await http()
      .get('/templates')
      .set('Authorization', as(token))
      .expect(200);
    const seg = await q(
      async (c) =>
        (await c.query(`SELECT id FROM segments WHERE name = 'T12 segment'`))
          .rows[0].id,
    );
    const camp = await http()
      .post('/campaigns')
      .set('Authorization', as(token))
      .send({ name: 'T12 snapshot', segmentId: seg, offerId })
      .expect(201);
    await http()
      .post(`/campaigns/${camp.body.id}/steps`)
      .set('Authorization', as(token))
      .send({ templateId: tpls.body[0].id, delayHours: 0 })
      .expect(201);
    await http()
      .post(`/campaigns/${camp.body.id}/enroll`)
      .set('Authorization', as(token))
      .expect(200);

    const snaps = await q(
      async (c) =>
        (
          await c.query(
            `SELECT l.company_key, cl.snapshot FROM campaign_leads cl JOIN leads l ON l.id = cl.lead_id
            WHERE cl.campaign_id = $1`,
            [camp.body.id],
          )
        ).rows,
    );
    const t1 = snaps.find((s: any) => s.company_key === 't1.test');
    const b2 = snaps.find((s: any) => s.company_key === 'b2.test');
    expect(t1.snapshot.preference_id).toBe(a.id);
    expect(t1.snapshot.preference_revision).toBe(1);
    expect(t1.snapshot.discovery_run_id).toBe(run.id);
    expect(b2.snapshot.preference_id).toBeNull();
    expect(b2.snapshot.discovery_run_id).toBe(run.id);
    await q((c) =>
      c.query(`DELETE FROM campaigns WHERE id = $1`, [camp.body.id]),
    );
  });

  // ── did it work? ────────────────────────────────────────────────────────

  it('results reproduce the spec worked example (12 of 200 vs 5 of 200, illustrative) and suggest the next batch', async () => {
    const a = await approve('city:reply:Pune');
    const runId = await mkRun(a.id);
    await bulkCompanies({
      runId,
      prefId: a.id,
      count: 200,
      qualified: 12,
      tag: 'tx',
    });
    await bulkCompanies({
      runId,
      prefId: null,
      count: 200,
      qualified: 5,
      tag: 'bx',
    });
    const res = await http()
      .get(`/search-preferences/${a.id}/results`)
      .set('Authorization', as(token))
      .expect(200);
    expect(res.body.targeted).toMatchObject({
      sent: 200,
      reached: 200,
      qualified: 12,
    });
    expect(res.body.baseline).toMatchObject({
      sent: 200,
      reached: 200,
      qualified: 5,
    });
    expect(res.body.runs).toBe(1);
    expect(res.body.targeted.qualifiedPerRun).toBe(12);
    expect(res.body.windowOpen).toBe(false);
    expect(res.body.verdict.qualifiedPerReached.targeted).toBeCloseTo(0.06, 5);
    expect(res.body.verdict.qualifiedPerReached.baseline).toBeCloseTo(0.025, 5);
    expect(res.body.verdict.diff.d).toBeCloseTo(0.035, 5);
    expect(res.body.verdict.state).toBe('test_next_batch');
  });

  it('results keep collecting while a reply window is open, and never mix in other runs', async () => {
    const a = await approve('city:reply:Pune');
    const runId = await mkRun(a.id);
    const otherRun = await mkRun(null);
    await bulkCompanies({
      runId,
      prefId: a.id,
      count: 40,
      qualified: 4,
      daysAgo: 3,
      tag: 'tw',
    });
    await bulkCompanies({
      runId,
      prefId: null,
      count: 40,
      qualified: 1,
      daysAgo: 3,
      tag: 'bw',
    });
    // companies from a run that never used the preference are not counted
    await bulkCompanies({
      runId: otherRun,
      prefId: null,
      count: 25,
      tag: 'ox',
    });
    const res = await http()
      .get(`/search-preferences/${a.id}/results`)
      .set('Authorization', as(token))
      .expect(200);
    expect(res.body.baseline.sent).toBe(40);
    expect(res.body.windowOpen).toBe(true);
    expect(res.body.verdict.state).toBe('keep_collecting');
  });
});
