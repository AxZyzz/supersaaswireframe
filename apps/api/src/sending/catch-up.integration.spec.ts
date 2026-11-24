/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument */
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'crypto';
import { Pool } from 'pg';
import request from 'supertest';
import { AppModule } from '../app.module';
import { PG_POOL } from '../db/db.module';
import { withOrgContext } from '../db/tenant-context';
import { verifyAllSenders } from '../../test/verify-senders';

jest.setTimeout(120_000);

/**
 * The catch-up guard (T18 follow-up): after an outage or a long pause a send
 * that is overdue by more than SEND_STALE_AFTER_HOURS (default 24) is moved into
 * the next SEND_CATCHUP_SPREAD_HOURS (default 24) instead of going out in a
 * burst. "How overdue" is the database's clock, so these tests rewind
 * next_send_at in the database and use the real loop and the real mock sender.
 */
describe('Catch-up guard (overdue sends after an outage)', () => {
  let app: INestApplication;
  let pool: Pool;
  let token: string;
  let orgId: string;
  let userId: string;
  let templateId: string;

  const http = () => request(app.getHttpServer());
  const auth = () => `Bearer ${token}`;
  const tick = async () =>
    (
      await http()
        .post('/sending/tick')
        .set('Authorization', auth())
        .expect(200)
    ).body as Record<string, number>;
  const q = <T = any>(sql: string, params: unknown[] = []) =>
    withOrgContext(
      pool,
      orgId,
      async (c) => (await c.query(sql, params)).rows as T[],
    );

  /** Make every active lead of this campaign due `interval` ago (database time). */
  const dueAgo = (campaignId: string, interval: string) =>
    q(
      `UPDATE campaign_leads SET next_send_at = now() - $2::interval
        WHERE campaign_id = $1 AND status = 'active'`,
      [campaignId, interval],
    );

  /** Seconds from the database's now() to each active lead's next_send_at (positive = future). */
  const ahead = async (campaignId: string) =>
    (
      await q<{ ahead: number }>(
        `SELECT EXTRACT(EPOCH FROM (next_send_at - now()))::float8 AS ahead
           FROM campaign_leads WHERE campaign_id = $1 AND status = 'active'
          ORDER BY next_send_at`,
        [campaignId],
      )
    ).map((r) => r.ahead);

  const sentCount = async (campaignId: string) =>
    (
      await q<{ n: number }>(
        `SELECT count(*)::int AS n FROM sent_emails
          WHERE campaign_id = $1 AND status = 'sent'`,
        [campaignId],
      )
    )[0].n;

  async function leadsIn(emails: string[]) {
    const seg = await http()
      .post('/segments')
      .set('Authorization', auth())
      .send({ name: `Seg-${randomUUID().slice(0, 8)}`, type: 'manual' })
      .expect(201);
    const leadIds: string[] = [];
    for (const email of emails) {
      const l = await http()
        .post('/leads')
        .set('Authorization', auth())
        .send({ email, firstName: email.split('@')[0] })
        .expect(201);
      leadIds.push(l.body.id);
    }
    await http()
      .post(`/segments/${seg.body.id}/members`)
      .set('Authorization', auth())
      .send({ leadIds })
      .expect(200);
    return { segmentId: seg.body.id as string, leadIds };
  }

  async function campaignWith(segmentId: string, delays: number[] = [0]) {
    const camp = await http()
      .post('/campaigns')
      .set('Authorization', auth())
      .send({ name: `C-${randomUUID().slice(0, 8)}`, segmentId })
      .expect(201);
    for (const delayHours of delays) {
      await http()
        .post(`/campaigns/${camp.body.id}/steps`)
        .set('Authorization', auth())
        .send({ templateId, delayHours })
        .expect(201);
    }
    await http()
      .post(`/campaigns/${camp.body.id}/enroll`)
      .set('Authorization', auth())
      .expect(200);
    return camp.body.id as string;
  }

  const emails = (tag: string, n: number) =>
    Array.from({ length: n }, (_, i) => `p${i}@${tag}-${i}.catchup.test`);

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

    const r = await http()
      .post('/auth/signup')
      .send({
        email: `cu-${randomUUID().slice(0, 8)}@test.local`,
        password: 'catchup-password-123',
        name: 'Catch-up',
        orgName: 'Catch-up Org',
      })
      .expect(201);
    token = r.body.accessToken;
    orgId = r.body.org.id;
    userId = r.body.user.id;

    await http()
      .post('/senders')
      .set('Authorization', auth())
      .send({
        provider: 'smtp',
        fromName: 'Rep',
        fromEmail: 'rep@catchup.local',
        dailyLimit: 500,
      })
      .expect(201);
    await verifyAllSenders(app.getHttpServer(), auth());
    await q(
      `UPDATE sender_accounts SET warmup_enabled = false, daily_limit = 500`,
    );
    const tpls = await http()
      .get('/templates')
      .set('Authorization', auth())
      .expect(200);
    templateId = tpls.body[0].id;
  });

  afterEach(async () => {
    delete process.env.SEND_STALE_AFTER_HOURS;
    delete process.env.SEND_CATCHUP_SPREAD_HOURS;
    // a tick sends for every due lead in the workspace: park what a test leaves behind
    await q(`UPDATE campaigns SET status = 'paused'`);
  });

  afterAll(async () => {
    delete process.env.THROTTLE_DISABLED;
    await withOrgContext(pool, orgId, (c) =>
      c.query(`DELETE FROM orgs WHERE id = $1`, [orgId]),
    );
    await pool.query(`DELETE FROM users WHERE id = $1`, [userId]);
    await app.close();
  });

  it('three days overdue: nothing goes out in a burst; each send moves into the next 24 hours, spread out; then they send normally', async () => {
    const { segmentId } = await leadsIn(emails('burst', 30));
    const camp = await campaignWith(segmentId);
    await dueAgo(camp, '3 days');

    const t1 = await tick();
    expect(t1.sent).toBe(0);
    expect(t1.deferred).toBe(30);
    expect(await sentCount(camp)).toBe(0);

    // all still waiting, each somewhere in the next 24 hours, and spread (not one moment)
    const wait = await ahead(camp);
    expect(wait).toHaveLength(30);
    expect(Math.min(...wait)).toBeGreaterThan(-5); // not left in the past
    expect(Math.max(...wait)).toBeLessThanOrEqual(24 * 3600 + 5);
    const hours = new Set(wait.map((s) => Math.floor(s / 3600)));
    expect(hours.size).toBeGreaterThanOrEqual(8);

    // moved once, not again: a second tick right away finds nothing due
    const t2 = await tick();
    expect(t2.sent).toBe(0);
    expect(await sentCount(camp)).toBe(0);

    // the moment arrives (only a minute late now): they send as normal, none is moved again
    await dueAgo(camp, '1 minute');
    const t3 = await tick();
    expect(t3.sent).toBe(30);
    expect(await sentCount(camp)).toBe(30);
  });

  it('only a little late (2 hours) is sent at once, as before', async () => {
    const { segmentId } = await leadsIn(emails('late', 3));
    const camp = await campaignWith(segmentId);
    await dueAgo(camp, '2 hours');
    const t = await tick();
    expect(t.sent).toBe(3);
    expect(t.deferred).toBe(0);
  });

  it('a follow-up that is days overdue is moved too (the first email was sent on time)', async () => {
    const { segmentId } = await leadsIn(emails('fup', 2));
    const camp = await campaignWith(segmentId, [0, 0]); // two steps, follow-up due at once
    const t1 = await tick();
    expect(t1.sent).toBe(2); // step 1 on time
    await dueAgo(camp, '3 days'); // the follow-up is now days overdue
    const t2 = await tick();
    expect(t2.sent).toBe(0);
    expect(t2.deferred).toBe(2);
    expect(await sentCount(camp)).toBe(2); // still only the two first emails
    for (const s of await ahead(camp)) {
      expect(s).toBeGreaterThan(-5);
      expect(s).toBeLessThanOrEqual(24 * 3600 + 5);
    }
  });

  it('SEND_STALE_AFTER_HOURS=0 turns the guard off: three days overdue sends now', async () => {
    process.env.SEND_STALE_AFTER_HOURS = '0';
    const { segmentId } = await leadsIn(emails('off', 3));
    const camp = await campaignWith(segmentId);
    await dueAgo(camp, '3 days');
    const t = await tick();
    expect(t.sent).toBe(3);
  });

  it('the limits are adjustable: stale after 2 hours, spread over 1 hour', async () => {
    process.env.SEND_STALE_AFTER_HOURS = '2';
    process.env.SEND_CATCHUP_SPREAD_HOURS = '1';
    const { segmentId } = await leadsIn(emails('cfg', 10));
    const camp = await campaignWith(segmentId);
    await dueAgo(camp, '3 hours');
    const t = await tick();
    expect(t.sent).toBe(0);
    expect(t.deferred).toBe(10);
    for (const s of await ahead(camp)) {
      expect(s).toBeGreaterThan(-5);
      expect(s).toBeLessThanOrEqual(3600 + 5);
    }
  });

  it('a lead that must not be emailed is still stopped, not rescheduled (suppression wins over the guard)', async () => {
    const { segmentId, leadIds } = await leadsIn(emails('supp', 2));
    const camp = await campaignWith(segmentId);
    const [suppressed] = await q<{ email: string }>(
      `SELECT email FROM leads WHERE id = $1`,
      [leadIds[0]],
    );
    await q(
      `INSERT INTO suppression_list (org_id, email, reason) VALUES ($1, $2, 'unsubscribed')`,
      [orgId, suppressed.email],
    );
    await dueAgo(camp, '3 days');
    const t = await tick();
    expect(t.suppressed).toBe(1);
    expect(t.deferred).toBe(1); // the other lead is moved
    const [row] = await q<{ status: string; stop_reason: string | null }>(
      `SELECT status, stop_reason FROM campaign_leads WHERE lead_id = $1`,
      [leadIds[0]],
    );
    expect(row).toEqual({ status: 'stopped', stop_reason: 'suppressed' });
  });

  it('a paused campaign that is resumed days later does not burst either', async () => {
    const { segmentId } = await leadsIn(emails('resume', 5));
    const camp = await campaignWith(segmentId);
    await http()
      .post(`/campaigns/${camp}/pause`)
      .set('Authorization', auth())
      .expect(200);
    await dueAgo(camp, '4 days'); // sat paused, overdue by 4 days
    expect((await tick()).sent).toBe(0); // paused: nothing is due to the loop
    await http()
      .post(`/campaigns/${camp}/resume`)
      .set('Authorization', auth())
      .expect(200);
    const t = await tick();
    expect(t.sent).toBe(0);
    expect(t.deferred).toBe(5);
    expect(await sentCount(camp)).toBe(0);
  });
});
