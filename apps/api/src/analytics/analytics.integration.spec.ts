/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-call */
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'crypto';
import { Pool } from 'pg';
import request from 'supertest';
import { AppModule } from '../app.module';
import { PG_POOL } from '../db/db.module';
import { withOrgContext } from '../db/tenant-context';

/** E8: org-wide analytics overview + per-campaign rows reflect real sends and
 *  opens; sender alerts surface unverified senders. */
describe('Analytics integration', () => {
  let app: INestApplication;
  let pool: Pool;
  let token: string;
  let orgId: string;
  let userId: string;
  let campaignId: string;

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

    const res = await request(app.getHttpServer())
      .post('/auth/signup')
      .send({
        email: `an-${randomUUID().slice(0, 8)}@test.local`,
        password: 'an-pass-123',
        name: 'An T',
        orgName: 'An Org',
      })
      .expect(201);
    token = res.body.accessToken;
    orgId = res.body.org.id;
    userId = res.body.user.id;
  });

  afterAll(async () => {
    await withOrgContext(pool, orgId, async (c) => {
      await c.query(`DELETE FROM orgs WHERE id = $1`, [orgId]);
    });
    await pool.query(`DELETE FROM users WHERE id = $1`, [userId]);
    await app.close();
  });

  const auth = () => `Bearer ${token}`;

  it('starts empty', async () => {
    const res = await request(app.getHttpServer())
      .get('/analytics/overview')
      .set('Authorization', auth())
      .expect(200);
    expect(res.body.sent.total).toBe(0);
    expect(res.body.campaigns.total).toBe(0);
    expect(res.body.engagement.opened).toBe(0);
  });

  it('reflects a send + open, per campaign and org-wide', async () => {
    await request(app.getHttpServer())
      .post('/senders')
      .set('Authorization', auth())
      .send({ provider: 'smtp', fromName: 'Rep', fromEmail: 'rep@an.local' })
      .expect(201);
    await request(app.getHttpServer())
      .post('/leads')
      .set('Authorization', auth())
      .send({ email: 'lead@an.local', firstName: 'Ana' })
      .expect(201);
    const tpls = await request(app.getHttpServer())
      .get('/templates')
      .set('Authorization', auth())
      .expect(200);
    const camp = await request(app.getHttpServer())
      .post('/campaigns')
      .set('Authorization', auth())
      .send({ name: 'An campaign' })
      .expect(201);
    campaignId = camp.body.id;
    await request(app.getHttpServer())
      .post(`/campaigns/${campaignId}/steps`)
      .set('Authorization', auth())
      .send({ templateId: tpls.body[0].id, delayHours: 0 })
      .expect(201);
    await request(app.getHttpServer())
      .post(`/campaigns/${campaignId}/enroll`)
      .set('Authorization', auth())
      .expect(200);
    await request(app.getHttpServer())
      .post('/sending/tick')
      .set('Authorization', auth())
      .expect(200);

    let trackingId = '';
    await withOrgContext(pool, orgId, async (c) => {
      const r = await c.query(
        `SELECT tracking_id FROM sent_emails WHERE campaign_id = $1`,
        [campaignId],
      );
      trackingId = r.rows[0].tracking_id;
    });
    await request(app.getHttpServer()).get(`/t/o/${trackingId}`).expect(200);

    const ov = await request(app.getHttpServer())
      .get('/analytics/overview')
      .set('Authorization', auth())
      .expect(200);
    expect(ov.body.leads.total).toBe(1);
    expect(ov.body.campaigns.active).toBe(1);
    expect(ov.body.sent.total).toBe(1);
    expect(ov.body.sent.last7).toBe(1);
    expect(ov.body.engagement.opened).toBe(1);
    expect(ov.body.activity.length).toBeGreaterThan(0);
    // the smtp sender was never verified -> alert
    expect(
      ov.body.alerts.some(
        (a: { kind: string }) => a.kind === 'sender_unverified',
      ),
    ).toBe(true);

    const rows = await request(app.getHttpServer())
      .get('/analytics/campaigns')
      .set('Authorization', auth())
      .expect(200);
    expect(rows.body).toHaveLength(1);
    expect(rows.body[0].sent).toBe(1);
    expect(rows.body[0].opened).toBe(1);
    expect(rows.body[0].enrolled).toBe(1);
  });
});
