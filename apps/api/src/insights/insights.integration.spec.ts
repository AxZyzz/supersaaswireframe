/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-call */
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'crypto';
import { Pool } from 'pg';
import request from 'supertest';
import { AppModule } from '../app.module';
import { PG_POOL } from '../db/db.module';
import { withOrgContext } from '../db/tenant-context';
import { InsightsService } from './insights.service';
import { PostgresInsightsSource } from './postgres-insights.source';
import { assertInsightsSourceContract } from './source-contract';

jest.setTimeout(120_000);

/**
 * Insights (T06) against a real Postgres: company-level counting, timezone
 * handling, honest send-time wording, funnel, filters, caching, roles and
 * tenant isolation.
 */
describe('Insights: Postgres source and API (T06)', () => {
  let app: INestApplication;
  let pool: Pool;
  let token: string;
  let orgId: string;
  let userId: string;
  let otherToken: string;
  let otherOrgId: string;
  let otherUserId: string;
  let agentToken: string;
  let agentId: string;
  let offerId: string;
  let campaign1: string; // main, no offer
  let campaign2: string; // with the offer
  let campaign3: string; // one send hour only
  const step: Record<string, string> = {};

  const http = () => request(app.getHttpServer());
  const auth = () => `Bearer ${token}`;
  const q = <T>(
    fn: (c: Parameters<Parameters<typeof withOrgContext>[2]>[0]) => Promise<T>,
  ) => withOrgContext(pool, orgId, fn);

  interface Co {
    campaign: string;
    key: string;
    contacts?: number;
    city?: string;
    trigger?: string;
    industry?: string;
    tz?: string | null;
    sentAt: Date;
    replied?: boolean;
    qualified?: 'verified' | 'provisional';
    bounced?: boolean;
    opened?: boolean;
    title?: string;
    stars?: number;
  }

  /** One company, `contacts` people, all sent step 1 at `sentAt`. */
  const company = async (o: Co) => {
    const refs: { leadId: string; clId: string; seId: string }[] = [];
    await q(async (c) => {
      for (let k = 0; k < (o.contacts ?? 1); k++) {
        const lead = await c.query<{ id: string }>(
          `INSERT INTO leads (org_id, email, company_key, title, source)
           VALUES ($1,$2,$3,$4,'csv') RETURNING id`,
          [orgId, `p${k}@${o.key}`, o.key, o.title ?? null],
        );
        const snap = {
          company_key: o.key,
          city: o.city ?? '',
          primary_trigger: o.trigger ?? 'unknown',
          industry: o.industry ?? 'unknown',
          timezone: o.tz === undefined ? 'Asia/Kolkata' : o.tz,
          stars: o.stars ?? null,
          source: 'expelly',
        };
        const cl = await c.query<{ id: string }>(
          `INSERT INTO campaign_leads (org_id, campaign_id, lead_id, status, snapshot)
           VALUES ($1,$2,$3,'active',$4::jsonb) RETURNING id`,
          [orgId, o.campaign, lead.rows[0].id, JSON.stringify(snap)],
        );
        const se = await c.query<{ id: string }>(
          `INSERT INTO sent_emails (org_id, campaign_id, campaign_lead_id, lead_id, step_id,
              to_email, subject, status, sent_at)
           VALUES ($1,$2,$3,$4,$5,$6,'Hello {company}','sent',$7) RETURNING id`,
          [
            orgId,
            o.campaign,
            cl.rows[0].id,
            lead.rows[0].id,
            step[o.campaign],
            `p${k}@${o.key}`,
            o.sentAt,
          ],
        );
        refs.push({
          leadId: lead.rows[0].id,
          clId: cl.rows[0].id,
          seId: se.rows[0].id,
        });
      }
      const first = refs[0];
      const ev = (type: string, verification: string, hours = 5) =>
        c.query(
          `INSERT INTO outcome_events (org_id, campaign_lead_id, lead_id, company_key, sent_email_id,
              type, source, verification, occurred_at, idempotency_key)
           VALUES ($1,$2,$3,$4,$5,$6,'manual',$7,$8,$9)`,
          [
            orgId,
            first.clId,
            first.leadId,
            o.key,
            first.seId,
            type,
            verification,
            new Date(o.sentAt.getTime() + hours * 3_600_000),
            randomUUID(),
          ],
        );
      if (o.opened) {
        await c.query(
          `INSERT INTO email_events (org_id, sent_email_id, campaign_id, lead_id, type)
           VALUES ($1,$2,$3,$4,'open')`,
          [orgId, first.seId, o.campaign, first.leadId],
        );
      }
      if (o.bounced) await ev('bounce', 'verified', 0);
      if (o.replied) await ev('reply', 'verified');
      if (o.qualified) await ev('qualified_reply', o.qualified);
    });
    return refs;
  };

  const insights = async (qs = '') =>
    (
      await http()
        .get(`/insights${qs}`)
        .set('Authorization', auth())
        .expect(200)
    ).body;

  // sends spread over Mon-Fri, 8am-6pm local (Asia/Kolkata = UTC+5:30)
  const when = (i: number) =>
    new Date(Date.UTC(2026, 10, 30 + (i % 5), 3 + (i % 5) * 2, 30));

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
    app.get(InsightsService).cacheEnabled = false;

    const a = await http()
      .post('/auth/signup')
      .send({
        email: `t06-a-${randomUUID().slice(0, 8)}@test.local`,
        password: 't06-password-123',
        name: 'T06 Admin',
        orgName: 'T06 Org A',
      })
      .expect(201);
    token = a.body.accessToken;
    orgId = a.body.org.id;
    userId = a.body.user.id;
    const b = await http()
      .post('/auth/signup')
      .send({
        email: `t06-b-${randomUUID().slice(0, 8)}@test.local`,
        password: 't06-password-123',
        name: 'T06 Other',
        orgName: 'T06 Org B',
      })
      .expect(201);
    otherToken = b.body.accessToken;
    otherOrgId = b.body.org.id;
    otherUserId = b.body.user.id;
    const inv = await http()
      .post('/orgs/invites')
      .set('Authorization', auth())
      .send({
        email: `t06-agent-${randomUUID().slice(0, 8)}@test.local`,
        role: 'agent',
      })
      .expect(201);
    const reg = await http()
      .post(`/invites/${inv.body.token}/register`)
      .send({ name: 'T06 Agent', password: 'agent-pass-123' })
      .expect(201);
    agentToken = reg.body.accessToken;
    agentId = reg.body.user.id;

    await q(async (c) => {
      const off = await c.query<{ id: string }>(
        `INSERT INTO offers (org_id, name) VALUES ($1,'T06 offer') RETURNING id`,
        [orgId],
      );
      offerId = off.rows[0].id;
      const mk = async (name: string, offer: string | null) => {
        const cp = await c.query<{ id: string }>(
          `INSERT INTO campaigns (org_id, name, status, offer_id) VALUES ($1,$2,'active',$3) RETURNING id`,
          [orgId, name, offer],
        );
        const st = await c.query<{ id: string }>(
          // the app numbers steps from 0 (campaigns.service: first step = 0), so the first touch is step_order 0
          `INSERT INTO campaign_steps (org_id, campaign_id, step_order, delay_hours) VALUES ($1,$2,0,0) RETURNING id`,
          [orgId, cp.rows[0].id],
        );
        step[cp.rows[0].id] = st.rows[0].id;
        return cp.rows[0].id;
      };
      campaign1 = await mk('T06 main', null);
      campaign2 = await mk('T06 offer campaign', offerId);
      campaign3 = await mk('T06 one hour', null);
    });

    // Pune: 60 hiring companies, 20 replied (8 verified qualified); Mumbai / Delhi: 60 each, 2 replied
    const spec: Array<[string, string, number, number]> = [
      ['Pune', 'hiring', 20, 8],
      ['Mumbai', 'none', 2, 0],
      ['Delhi', 'none', 2, 0],
    ];
    for (const [city, trigger, replies, qualified] of spec) {
      for (let i = 0; i < 60; i++) {
        await company({
          campaign: campaign1,
          key: `${city.toLowerCase()}-${i}.test`,
          city,
          trigger,
          industry: i % 2 ? 'saas' : 'ecommerce',
          sentAt: when(i),
          replied: i < replies,
          qualified: i < qualified ? 'verified' : undefined,
          opened: i % 3 === 0,
          stars: (i % 5) + 1,
          title: i % 4 === 0 ? 'Founder' : 'Manager',
        });
      }
    }
  });

  afterAll(async () => {
    delete process.env.THROTTLE_DISABLED;
    for (const o of [orgId, otherOrgId]) {
      await withOrgContext(pool, o, (c) =>
        c.query(`DELETE FROM orgs WHERE id = $1`, [o]),
      );
    }
    for (const u of [userId, otherUserId, agentId]) {
      await pool.query(`DELETE FROM users WHERE id = $1`, [u]);
    }
    await app.close();
  });

  const bucket = (data: any, factor: string, name: string) =>
    data.factors
      .find((f: any) => f.def.id === factor)
      .rows.find((b: any) => b.bucket === name);

  it('the Postgres source keeps the shared contract (T07 BigQuery must pass the same checks)', async () => {
    await assertInsightsSourceContract(app.get(PostgresInsightsSource), {
      orgId,
    });
  });

  it('answers in plain sentences with n, rate and range, and labels itself exploratory', async () => {
    const d = await insights();
    expect(d.source).toBe('postgres');
    expect(d.totals.reached).toBe(180);
    expect(d.note).toContain('Exploratory');
    // 8 of Pune's 20 replies were confirmed qualified (all interested replies are
    // settled), so the page leads with the strongest signal
    expect(d.headlineMetric).toBe('qualified');
    const pune = d.headlines.find((h: any) => h.factor === 'city');
    expect(pune.bucket).toBe('Pune');
    expect(pune.sentence).toBe(
      'City: Pune gets the most confirmed qualified replies: 13.3% (8 of 60 companies), range 6.9% to 24.2%. Overall: 4.4%.',
    );
    // ...and plain replies still point at Pune: 20 of 60 against 13.3% overall
    const city = d.factors.find((f: any) => f.def.id === 'city');
    expect(city.evals.reply.best.bucket).toBe('Pune');
    expect(city.evals.reply.best.x).toBe(20);
    expect(city.evals.reply.best.n).toBe(60);
    expect(city.evals.reply.overall.p).toBeCloseTo(24 / 180, 5);
    expect(pune.exploratory).toContain('Test it before acting');
    expect(pune.searchable).toBe(true);
    // Pune is entirely "hiring": the confounding hint appears
    expect(pune.confounding).toContain('Most of these were also hiring');
    expect(pune.confounding).toContain(
      'Compare within trigger before deciding.',
    );
  });

  it('counts each company once, even with two contacts, and counts hand-checked numbers', async () => {
    const before = await insights();
    await company({
      campaign: campaign1,
      key: 'two-contacts.test',
      contacts: 2,
      city: 'Pune',
      trigger: 'hiring',
      sentAt: when(1),
      replied: true,
      qualified: 'verified',
    });
    const after = await insights();
    expect(after.totals.reached).toBe(before.totals.reached + 1);
    expect(bucket(after, 'city', 'Pune').reached).toBe(
      bucket(before, 'city', 'Pune').reached + 1,
    );
    expect(bucket(after, 'city', 'Pune').qualified).toBe(9);
    expect(bucket(after, 'city', 'Pune').replied).toBe(21);
  });

  it('a bounced company is "sent" but not "reached"; provisional counts as interested, never as qualified', async () => {
    const before = await insights();
    await company({
      campaign: campaign1,
      key: 'bounce.test',
      city: 'Delhi',
      trigger: 'none',
      sentAt: when(2),
      bounced: true,
    });
    await company({
      campaign: campaign1,
      key: 'prov.test',
      city: 'Delhi',
      trigger: 'none',
      sentAt: when(3),
      replied: true,
      qualified: 'provisional',
    });
    const after = await insights();
    const d0 = bucket(before, 'city', 'Delhi');
    const d1 = bucket(after, 'city', 'Delhi');
    expect(d1.sent).toBe(d0.sent + 2);
    expect(d1.reached).toBe(d0.reached + 1); // the bounced one is not reached
    expect(d1.bounced).toBe(d0.bounced + 1);
    expect(d1.positive).toBe(d0.positive + 1);
    expect(d1.qualified).toBe(d0.qualified);
  });

  it('a reply that cannot be tied to the enrollment is not credited to any factor', async () => {
    const before = await insights();
    const [ref] = await company({
      campaign: campaign1,
      key: 'stray.test',
      city: 'Mumbai',
      trigger: 'none',
      sentAt: when(4),
    });
    await q((c) =>
      c.query(
        `INSERT INTO outcome_events (org_id, lead_id, company_key, type, source, verification, idempotency_key)
         VALUES ($1,$2,'stray.test','reply','system','verified',$3)`,
        [orgId, ref.leadId, randomUUID()],
      ),
    );
    const after = await insights();
    expect(bucket(after, 'city', 'Mumbai').replied).toBe(
      bucket(before, 'city', 'Mumbai').replied,
    );
    expect(bucket(after, 'city', 'Mumbai').reached).toBe(
      bucket(before, 'city', 'Mumbai').reached + 1,
    );
  });

  it('send time uses the recipient timezone: 04:30 UTC to Asia/Kolkata is the 10 am-12 block; no timezone falls back to the workspace and is counted', async () => {
    const before = await insights();
    await company({
      campaign: campaign1,
      key: 'kolkata.test',
      city: 'Pune',
      trigger: 'hiring',
      sentAt: new Date('2026-12-02T04:30:00Z'),
      tz: 'Asia/Kolkata',
    });
    await company({
      campaign: campaign1,
      key: 'notz.test',
      city: 'Pune',
      trigger: 'hiring',
      sentAt: new Date('2026-12-02T04:30:00Z'),
      tz: null,
    });
    const after = await insights();
    expect(bucket(after, 'send_hour', '10 am-12').reached).toBe(
      bucket(before, 'send_hour', '10 am-12').reached + 1,
    );
    expect(bucket(after, 'send_day', 'Wed').reached).toBeGreaterThan(0);
    expect(after.timezone.workspace).toBe(before.timezone.workspace + 1);
    expect(after.timezone.recipient).toBe(before.timezone.recipient + 1);
    expect(after.timezone.workspaceZone).toBeTruthy();
    // 04:30 UTC with no recipient zone is 04:30 workspace (UTC) time: outside 6-22 -> "other"
    expect(bucket(after, 'send_hour', 'other').reached).toBe(
      (bucket(before, 'send_hour', 'other')?.reached ?? 0) + 1,
    );
  });

  it('when send times were varied, the grid and the comparison are available', async () => {
    const d = await insights();
    expect(d.sendTime.status.comparable).toBe(true);
    expect(d.sendTime.grid.length).toBeGreaterThan(3);
    const hour = d.factors.find((f: any) => f.def.id === 'send_hour');
    expect(hour.comparable).toBe(true);
  });

  it('a narrow send window says so honestly and never presents a "best time"', async () => {
    for (let i = 0; i < 40; i++) {
      await company({
        campaign: campaign3,
        key: `narrow-${i}.test`,
        city: 'Pune',
        trigger: 'hiring',
        sentAt: new Date('2026-12-03T05:30:00Z'), // 11:00 in Kolkata, always
        replied: i < 10,
      });
    }
    const d = await insights(`?campaignId=${campaign3}`);
    expect(d.totals.reached).toBe(40);
    expect(d.sendTime.status.comparable).toBe(false);
    expect(d.sendTime.status.message).toContain(
      "We've only sent between 10 am-12",
    );
    expect(d.sendTime.status.message).toContain("can't compare times yet");
    for (const f of ['send_day', 'send_hour']) {
      expect(d.factors.find((x: any) => x.def.id === f).comparable).toBe(false);
    }
    expect(d.headlines.every((h: any) => !h.factor.startsWith('send_'))).toBe(
      true,
    );
    expect(JSON.stringify(d.sendTime)).not.toMatch(/best time/i);
  });

  it('filters by offer and by campaign', async () => {
    await company({
      campaign: campaign2,
      key: 'offer-1.test',
      city: 'Pune',
      sentAt: when(0),
      replied: true,
    });
    const byOffer = await insights(`?offerId=${offerId}`);
    expect(byOffer.totals.reached).toBe(1);
    const byCampaign = await insights(`?campaignId=${campaign2}`);
    expect(byCampaign.totals.reached).toBe(1);
    const both = await insights(`?campaignId=${campaign2},${campaign3}`);
    expect(both.totals.reached).toBe(41);
    const future = await insights(
      `?from=${encodeURIComponent('2030-01-01T00:00:00Z')}`,
    );
    expect(future.totals.reached).toBe(0);
  });

  it('the Discover funnel counts discovered and eligible prospects, joined by offer', async () => {
    await q(async (c) => {
      const run = await c.query<{ id: string }>(
        `INSERT INTO prospect_runs (org_id, goal, status, offer_id) VALUES ($1,'t','done',$2) RETURNING id`,
        [orgId, offerId],
      );
      for (const [i, mx] of [true, false].entries()) {
        await c.query(
          `INSERT INTO prospects (org_id, run_id, company_name, domain, status, city, industry, emails)
           VALUES ($1,$2,$3,$4,'verified','Nagpur','saas',$5::jsonb)`,
          [
            orgId,
            run.rows[0].id,
            `Nagpur ${i}`,
            `nagpur-${i}.test`,
            JSON.stringify([
              { email: `a@nagpur-${i}.test`, onCompanyDomain: true, mx },
            ]),
          ],
        );
      }
    });
    const d = await insights(`?offerId=${offerId}`);
    const nagpur = bucket(d, 'city', 'Nagpur');
    expect(nagpur).toMatchObject({ discovered: 2, eligible: 1, reached: 0 });
    // factors that are not Discover-searchable have no funnel
    expect(bucket(d, 'role', 'unknown')?.discovered ?? 0).toBe(0);
  });

  it('shows "unknown" buckets explicitly and the fit-score check', async () => {
    const d = await insights();
    const industry = d.factors
      .find((f: any) => f.def.id === 'industry')
      .rows.map((b: any) => b.bucket);
    expect(industry).toContain('unknown');
    expect(
      d.factors
        .find((f: any) => f.def.id === 'trigger')
        .rows.map((b: any) => b.bucket),
    ).toEqual(expect.arrayContaining(['hiring', 'none', 'unknown']));
    expect(d.stars).toHaveProperty('warn');
  });

  it('never includes simulated Review data (Insights does not read it)', async () => {
    const before = await insights();
    await http()
      .post('/review/simulate')
      .set('Authorization', auth())
      .send({ scenario: 'valid_winner' })
      .expect(200);
    const after = await insights();
    expect(after.totals).toEqual(before.totals);
    expect(JSON.stringify(after.factors)).not.toContain('sim-');
  });

  it('another workspace sees none of this (tenant isolation)', async () => {
    const r = await http()
      .get('/insights')
      .set('Authorization', `Bearer ${otherToken}`)
      .expect(200);
    expect(r.body.totals.reached).toBe(0);
    expect(r.body.headlines).toEqual([]);
    await assertInsightsSourceContract(app.get(PostgresInsightsSource), {
      orgId: otherOrgId,
    });
  });

  it('every role can view; bad filters are rejected', async () => {
    await http()
      .get('/insights')
      .set('Authorization', `Bearer ${agentToken}`)
      .expect(200);
    await http()
      .get('/insights?offerId=not-a-uuid')
      .set('Authorization', auth())
      .expect(400);
    await http()
      .get('/insights?campaignId=nope')
      .set('Authorization', auth())
      .expect(400);
    await http()
      .get('/insights?from=garbage')
      .set('Authorization', auth())
      .expect(400);
    await http().get('/insights').expect(401);
  });

  it('caches for 10 minutes per workspace and filters, and serves the cached copy next', async () => {
    const svc = app.get(InsightsService);
    svc.cacheEnabled = true;
    try {
      const url = `/insights?campaignId=${campaign3}`;
      const first = (
        await http().get(url).set('Authorization', auth()).expect(200)
      ).body;
      const second = (
        await http().get(url).set('Authorization', auth()).expect(200)
      ).body;
      expect(first.cached).toBe(false);
      expect(second.cached).toBe(true);
      expect(second.generatedAt).toBe(first.generatedAt);
      // a different filter is a different cache entry
      const other = (
        await http()
          .get(`/insights?campaignId=${campaign2}`)
          .set('Authorization', auth())
          .expect(200)
      ).body;
      expect(other.cached).toBe(false);
      // and another workspace never reads this one's entry
      const b = (
        await http()
          .get(url)
          .set('Authorization', `Bearer ${otherToken}`)
          .expect(200)
      ).body;
      expect(b.totals.reached).toBe(0);
    } finally {
      svc.cacheEnabled = false;
    }
  });
});
