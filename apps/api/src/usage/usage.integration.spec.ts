/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-call */
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'crypto';
import { Pool } from 'pg';
import request from 'supertest';
import { AppModule } from '../app.module';
import { PG_POOL } from '../db/db.module';
import { withOrgContext } from '../db/tenant-context';
import { PLAN_LIMITS } from './plan-limits';
import { verifyAllSenders } from '../../test/verify-senders';

/** Plan limits are enforced at every write path, with the real beta numbers
 *  shrunk per test so each cap is reachable. */
describe('Usage limits integration', () => {
  let app: INestApplication;
  let pool: Pool;
  let token: string;
  let orgId: string;
  let userId: string;
  const original = { ...PLAN_LIMITS.beta };

  const http = () => request(app.getHttpServer());
  const auth = () => `Bearer ${token}`;
  const limit = (patch: Partial<typeof original>) =>
    Object.assign(PLAN_LIMITS.beta, patch);
  const sql = (q: string, p: unknown[] = []) =>
    withOrgContext(pool, orgId, (c) => c.query(q, p));
  const lead = (email: string) =>
    http().post('/leads').set('Authorization', auth()).send({ email });
  const campaignWithStep = async (name: string) => {
    const tpls = await http().get('/templates').set('Authorization', auth());
    const camp = await http()
      .post('/campaigns')
      .set('Authorization', auth())
      .send({ name })
      .expect(201);
    await http()
      .post(`/campaigns/${camp.body.id}/steps`)
      .set('Authorization', auth())
      .send({ templateId: tpls.body[0].id, delayHours: 0 })
      .expect(201);
    return camp.body.id as string;
  };

  beforeAll(async () => {
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
    const res = await http()
      .post('/auth/signup')
      .send({
        email: `usage-${randomUUID().slice(0, 8)}@test.local`,
        password: 'usage-pass-123',
        name: 'Usage T',
        orgName: 'Usage Org',
      })
      .expect(201);
    token = res.body.accessToken;
    orgId = res.body.org.id;
    userId = res.body.user.id;
  });

  afterEach(() => Object.assign(PLAN_LIMITS.beta, original));

  afterAll(async () => {
    Object.assign(PLAN_LIMITS.beta, original);
    await sql(`DELETE FROM orgs WHERE id = $1`, [orgId]);
    await pool.query(`DELETE FROM users WHERE id = $1`, [userId]);
    await app.close();
  });

  it('reports plan and usage', async () => {
    const r = await http()
      .get('/usage')
      .set('Authorization', auth())
      .expect(200);
    expect(r.body.plan).toBe('beta');
    const leads = r.body.items.find((i: { key: string }) => i.key === 'leads');
    expect(leads).toMatchObject({ used: 0, limit: 2000 });
    expect(r.body.stepsPerCampaign).toBe(5);
  });

  it('caps leads across manual create, API upsert and CSV import', async () => {
    limit({ leads: 3 });
    await lead('a@u.local').expect(201);
    await lead('b@u.local').expect(201);

    // CSV with 2 new rows + 1 existing: one fits, one hits the cap, the
    // existing row still updates.
    const csv = [
      'Email,First',
      'c@u.local,C',
      'd@u.local,D',
      'a@u.local,A',
    ].join('\n');
    const start = await http()
      .post('/leads/import')
      .set('Authorization', auth())
      .field('mapping', JSON.stringify({ Email: 'email', First: 'firstName' }))
      .field('onDuplicate', 'update')
      .attach('file', Buffer.from(csv), 'leads.csv')
      .expect(201);
    let job:
      | {
          status: string;
          imported: number;
          updated: number;
          skipped: number;
          errors: { reason: string }[];
        }
      | undefined;
    for (let i = 0; i < 60 && job?.status !== 'completed'; i++) {
      await new Promise((r) => setTimeout(r, 250));
      job = (
        await http()
          .get(`/leads/import/${start.body.jobId}`)
          .set('Authorization', auth())
      ).body;
    }
    expect(job).toMatchObject({
      status: 'completed',
      imported: 1,
      updated: 1,
      skipped: 1,
    });
    expect(job!.errors[0].reason).toMatch(/limit/i);

    const blocked = await lead('e@u.local').expect(403);
    expect(blocked.body.code).toBe('LIMIT_REACHED');
    expect(blocked.body.message).toMatch(/limit of 3 leads/);

    const key = await http()
      .post('/api-keys')
      .set('Authorization', auth())
      .send({ name: 'k' });
    await http()
      .post('/v1/leads')
      .set('X-Api-Key', key.body.key)
      .send({ email: 'f@u.local' })
      .expect(403);
    // updating an existing lead over the API is still fine at the cap
    await http()
      .post('/v1/leads')
      .set('X-Api-Key', key.body.key)
      .send({ email: 'b@u.local', company: 'B Co' })
      .expect(200);
  });

  it('caps senders and steps per campaign', async () => {
    limit({ senders: 1, stepsPerCampaign: 1 });
    await http()
      .post('/senders')
      .set('Authorization', auth())
      .send({ provider: 'smtp', fromName: 'Rep', fromEmail: 'rep@u.local' })
      .expect(201);
    await verifyAllSenders(app.getHttpServer(), auth());
    await http()
      .post('/senders')
      .set('Authorization', auth())
      .send({ provider: 'smtp', fromName: 'Rep2', fromEmail: 'rep2@u.local' })
      .expect(403);

    const id = await campaignWithStep('Steps');
    const tpls = await http().get('/templates').set('Authorization', auth());
    await http()
      .post(`/campaigns/${id}/steps`)
      .set('Authorization', auth())
      .send({ templateId: tpls.body[0].id, delayHours: 24 })
      .expect(403);
    await http()
      .post('/ai/campaigns/from-sequence')
      .set('Authorization', auth())
      .send({
        name: 'Too long',
        steps: [
          { subject: 'One', body: 'b', delayHours: 0 },
          { subject: 'Two', body: 'b', delayHours: 24 },
        ],
      })
      .expect(403);
  });

  it('caps active campaigns across enroll, resume and schedule', async () => {
    limit({ activeCampaigns: 1 });
    const a = await campaignWithStep('A');
    const b = await campaignWithStep('B');
    await http()
      .post(`/campaigns/${a}/enroll`)
      .set('Authorization', auth())
      .expect(200);
    await http()
      .post(`/campaigns/${b}/enroll`)
      .set('Authorization', auth())
      .expect(403);
    const later = new Date(Date.now() + 86_400_000).toISOString();
    await http()
      .post(`/campaigns/${b}/schedule`)
      .set('Authorization', auth())
      .send({ scheduledAt: later })
      .expect(403);
    // re-enrolling the already-active campaign doesn't count twice
    await http()
      .post(`/campaigns/${a}/enroll`)
      .set('Authorization', auth())
      .expect(200);

    await http()
      .post(`/campaigns/${a}/pause`)
      .set('Authorization', auth())
      .expect(200);
    await http()
      .post(`/campaigns/${b}/enroll`)
      .set('Authorization', auth())
      .expect(200);
    await http()
      .post(`/campaigns/${a}/resume`)
      .set('Authorization', auth())
      .expect(403);
  });

  it('defers sends once the daily email cap is used, without dropping them', async () => {
    // B is active from the previous test with the 3 leads that fit the cap.
    limit({ emailsPerDay: 1 });
    const tick = await http()
      .post('/sending/tick')
      .set('Authorization', auth())
      .expect(200);
    expect(tick.body.sent).toBe(1);
    expect(tick.body.deferred).toBeGreaterThanOrEqual(1);
    const pending = await sql(
      `SELECT count(*)::int AS n FROM campaign_leads
       WHERE status = 'active' AND current_step = 0`,
    );
    expect(pending.rows[0].n).toBeGreaterThanOrEqual(1); // still queued

    // the dashboard warns at the cap
    const ov = await http()
      .get('/analytics/overview')
      .set('Authorization', auth());
    expect(
      ov.body.alerts.some(
        (x: { kind: string; message: string }) =>
          x.kind === 'usage_near_limit' && /emails per day/.test(x.message),
      ),
    ).toBe(true);
  });

  it('caps AI generations per month', async () => {
    limit({ aiGenerationsPerMonth: 1 });
    await http()
      .post('/ai/generate-sequence')
      .set('Authorization', auth())
      .send({ goal: 'Book demos', steps: 2 })
      .expect(200);
    // usage is logged right after the call; give the async insert a beat
    await new Promise((r) => setTimeout(r, 300));
    await http()
      .post('/ai/generate-sequence')
      .set('Authorization', auth())
      .send({ goal: 'Book demos', steps: 2 })
      .expect(403);
  });

  it('caps seats including pending invites; revoking frees a seat', async () => {
    limit({ members: 2 });
    const first = await http()
      .post('/orgs/invites')
      .set('Authorization', auth())
      .send({ email: 'one@u.local', role: 'agent' })
      .expect(201);
    await http()
      .post('/orgs/invites')
      .set('Authorization', auth())
      .send({ email: 'two@u.local', role: 'agent' })
      .expect(403);
    await http()
      .delete(`/orgs/invites/${first.body.id}`)
      .set('Authorization', auth())
      .expect(200);
    await http()
      .post('/orgs/invites')
      .set('Authorization', auth())
      .send({ email: 'two@u.local', role: 'agent' })
      .expect(201);
  });

  it('internal plan is unlimited', async () => {
    limit({ leads: 0 });
    await lead('blocked@u.local').expect(403);
    await sql(`UPDATE orgs SET plan = 'internal' WHERE id = $1`, [orgId]);
    await lead('free@u.local').expect(201);
    const r = await http().get('/usage').set('Authorization', auth());
    expect(r.body.plan).toBe('internal');
    expect(
      r.body.items.every((i: { limit: number | null }) => i.limit === null),
    ).toBe(true);
  });
});
