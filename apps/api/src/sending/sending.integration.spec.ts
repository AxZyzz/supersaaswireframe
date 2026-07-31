/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-return */
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'crypto';
import { Pool } from 'pg';
import request from 'supertest';
import { AppModule } from '../app.module';
import { PG_POOL } from '../db/db.module';
import { withOrgContext } from '../db/tenant-context';

/** Send engine: due-scan tick renders + delivers (mock), records sent_emails +
 *  events, advances the per-lead state, enforces suppression, assigns A/B. */
describe('Sending integration', () => {
  let app: INestApplication;
  let pool: Pool;
  let token: string;
  let orgId: string;
  let userId: string;

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

    const email = `send-${randomUUID().slice(0, 8)}@test.local`;
    const res = await request(app.getHttpServer())
      .post('/auth/signup')
      .send({
        email,
        password: 'send-pass-123',
        name: 'Send T',
        orgName: 'Send Org',
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

  it('sends due steps, records, advances, and enforces suppression', async () => {
    // sender (mock driver delivers it; EMAIL_DRIVER=mock in test env)
    await request(app.getHttpServer())
      .post('/senders')
      .set('Authorization', auth())
      .send({ provider: 'smtp', fromName: 'Rep', fromEmail: 'rep@send.local' })
      .expect(201);

    // two leads; one will be suppressed before enroll
    const good = await request(app.getHttpServer())
      .post('/leads')
      .set('Authorization', auth())
      .send({ email: 'good@lead.local', firstName: 'Gina' })
      .expect(201);
    const supp = await request(app.getHttpServer())
      .post('/leads')
      .set('Authorization', auth())
      .send({ email: 'supp@lead.local', firstName: 'Sam' })
      .expect(201);

    await withOrgContext(pool, orgId, async (c) => {
      await c.query(
        `INSERT INTO suppression_list (org_id, email, reason) VALUES ($1,$2,'unsubscribed')`,
        [orgId, 'supp@lead.local'],
      );
    });

    // template + campaign + one step with A/B subjects
    const tpls = await request(app.getHttpServer())
      .get('/templates')
      .set('Authorization', auth())
      .expect(200);
    const templateId = tpls.body[0].id;

    const camp = await request(app.getHttpServer())
      .post('/campaigns')
      .set('Authorization', auth())
      .send({ name: 'Send test' })
      .expect(201);
    const campaignId = camp.body.id;

    await request(app.getHttpServer())
      .post(`/campaigns/${campaignId}/steps`)
      .set('Authorization', auth())
      .send({
        templateId,
        delayHours: 0,
        condition: 'always',
        subjectVariants: ['Variant A {first_name|there}', 'Variant B'],
      })
      .expect(201);

    const enroll = await request(app.getHttpServer())
      .post(`/campaigns/${campaignId}/enroll`)
      .set('Authorization', auth())
      .expect(200);
    expect(enroll.body.enrolled).toBe(2);

    // process due sends
    const tick = await request(app.getHttpServer())
      .post('/sending/tick')
      .set('Authorization', auth())
      .expect(200);
    expect(tick.body.sent).toBe(1);
    expect(tick.body.suppressed).toBe(1);

    // verify persisted state directly
    await withOrgContext(pool, orgId, async (c) => {
      const sent = await c.query(
        `SELECT to_email, subject, status, variant_index, tracking_id, message_id
         FROM sent_emails WHERE campaign_id = $1`,
        [campaignId],
      );
      expect(sent.rowCount).toBe(1);
      expect(sent.rows[0].to_email).toBe('good@lead.local');
      expect(sent.rows[0].status).toBe('sent');
      expect(sent.rows[0].variant_index).toBe(0);
      expect(sent.rows[0].subject).toBe('Variant A Gina'); // A/B[0], rendered
      expect(sent.rows[0].tracking_id).toBeTruthy();
      expect(sent.rows[0].message_id).toMatch(/^mock-/);

      const ev = await c.query(
        `SELECT type FROM email_events WHERE campaign_id = $1`,
        [campaignId],
      );
      expect(ev.rows.map((r: any) => r.type)).toContain('sent');

      // good lead completed (single step); suppressed lead stopped
      const goodState = await c.query(
        `SELECT status FROM campaign_leads WHERE campaign_id = $1 AND lead_id = $2`,
        [campaignId, good.body.id],
      );
      expect(goodState.rows[0].status).toBe('completed');
      const suppState = await c.query(
        `SELECT status, stop_reason FROM campaign_leads WHERE campaign_id = $1 AND lead_id = $2`,
        [campaignId, supp.body.id],
      );
      expect(suppState.rows[0].status).toBe('stopped');
      expect(suppState.rows[0].stop_reason).toBe('suppressed');

      // lead timeline mirrors the send
      const lt = await c.query(
        `SELECT type FROM lead_events WHERE lead_id = $1`,
        [good.body.id],
      );
      expect(lt.rows.map((r: any) => r.type)).toContain('email_sent');
    });

    // second tick has nothing due (lead completed) -> no new sends
    const tick2 = await request(app.getHttpServer())
      .post('/sending/tick')
      .set('Authorization', auth())
      .expect(200);
    expect(tick2.body.sent).toBe(0);
  });
});
