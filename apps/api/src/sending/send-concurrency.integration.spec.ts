/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument */
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'crypto';
import { Pool } from 'pg';
import request from 'supertest';
import { AppModule } from '../app.module';
import { PG_POOL } from '../db/db.module';
import { withOrgContext } from '../db/tenant-context';

/** Overlapping send ticks must never email the same lead twice. */
describe('Send concurrency', () => {
  let app: INestApplication;
  let pool: Pool;
  let token: string;
  let orgId: string;
  let userId: string;
  const http = () => request(app.getHttpServer());
  const auth = () => `Bearer ${token}`;

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
    const r = await http()
      .post('/auth/signup')
      .send({
        email: `cc-${randomUUID().slice(0, 8)}@test.local`,
        password: 'cc-pass-123',
        name: 'Cc',
        orgName: 'Concurrency Org',
      })
      .expect(201);
    token = r.body.accessToken;
    orgId = r.body.org.id;
    userId = r.body.user.id;
  });

  afterAll(async () => {
    await withOrgContext(pool, orgId, (c) =>
      c.query(`DELETE FROM orgs WHERE id = $1`, [orgId]),
    );
    await pool.query(`DELETE FROM users WHERE id = $1`, [userId]);
    await app.close();
  });

  it('three simultaneous ticks send each due lead exactly once', async () => {
    await http()
      .post('/senders')
      .set('Authorization', auth())
      .send({ provider: 'smtp', fromName: 'Rep', fromEmail: 'rep@cc.local' })
      .expect(201);
    for (let i = 0; i < 5; i++) {
      await http()
        .post('/leads')
        .set('Authorization', auth())
        .send({ email: `lead${i}@cc.local` })
        .expect(201);
    }
    const tpls = await http().get('/templates').set('Authorization', auth());
    const camp = await http()
      .post('/campaigns')
      .set('Authorization', auth())
      .send({ name: 'Race' })
      .expect(201);
    for (const delayHours of [0, 48]) {
      await http()
        .post(`/campaigns/${camp.body.id}/steps`)
        .set('Authorization', auth())
        .send({ templateId: tpls.body[0].id, delayHours })
        .expect(201);
    }
    await http()
      .post(`/campaigns/${camp.body.id}/enroll`)
      .set('Authorization', auth())
      .expect(200);

    const ticks = await Promise.all(
      [1, 2, 3].map(() =>
        http().post('/sending/tick').set('Authorization', auth()),
      ),
    );
    const sent = ticks.reduce((n, t) => n + (t.body.sent as number), 0);
    expect(sent).toBe(5);

    await withOrgContext(pool, orgId, async (c) => {
      const r = await c.query(
        `SELECT lead_id, count(*)::int AS n FROM sent_emails GROUP BY lead_id`,
      );
      expect(r.rows).toHaveLength(5);
      expect(r.rows.every((x: { n: number }) => x.n === 1)).toBe(true);
      // and each lead moved on to step 2, scheduled ~48h out (not the lease)
      const cl = await c.query(
        `SELECT current_step, next_send_at > now() + interval '47 hours' AS later
         FROM campaign_leads`,
      );
      expect(
        cl.rows.every(
          (x: { current_step: number; later: boolean }) =>
            x.current_step === 1 && x.later,
        ),
      ).toBe(true);
    });
  });
});
