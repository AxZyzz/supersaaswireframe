/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument */
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'crypto';
import { Pool } from 'pg';
import request from 'supertest';
import { AppModule } from '../app.module';
import { PG_POOL } from '../db/db.module';
import { withOrgContext } from '../db/tenant-context';

/** T5.2: a brand-new sender is held to the day-1 warm-up cap (20/day). */
describe('Warm-up ramp (send engine)', () => {
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
        email: `wu-${randomUUID().slice(0, 8)}@test.local`,
        password: 'wu-pass-123',
        name: 'Wu',
        orgName: 'Warmup Org',
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

  it('caps a new sender at 20/day, reports it, and lifts the cap when disabled', async () => {
    const sender = await http()
      .post('/senders')
      .set('Authorization', auth())
      .send({
        provider: 'smtp',
        fromName: 'Rep',
        fromEmail: 'rep@wu.local',
        dailyLimit: 200,
      })
      .expect(201);
    expect(sender.body).toMatchObject({
      warmup_enabled: true,
      warmup_day: 1,
      daily_limit: 200,
      effective_daily_limit: 20,
    });

    for (let i = 0; i < 25; i++) {
      await http()
        .post('/leads')
        .set('Authorization', auth())
        .send({ email: `l${i}@wu.local` })
        .expect(201);
    }
    const tpls = await http().get('/templates').set('Authorization', auth());
    const camp = await http()
      .post('/campaigns')
      .set('Authorization', auth())
      .send({ name: 'Ramp' })
      .expect(201);
    await http()
      .post(`/campaigns/${camp.body.id}/steps`)
      .set('Authorization', auth())
      .send({ templateId: tpls.body[0].id, delayHours: 0 })
      .expect(201);
    await http()
      .post(`/campaigns/${camp.body.id}/enroll`)
      .set('Authorization', auth())
      .expect(200);

    const first = await http()
      .post('/sending/tick')
      .set('Authorization', auth())
      .expect(200);
    expect(first.body.sent).toBe(20);
    expect(first.body.deferred).toBe(5);

    // an established mailbox can opt out of the ramp
    const off = await http()
      .patch(`/senders/${sender.body.id}`)
      .set('Authorization', auth())
      .send({ warmupEnabled: false })
      .expect(200);
    expect(off.body).toMatchObject({
      warmup_day: null,
      effective_daily_limit: 200,
    });
    // deferred leads hold a short lease; make them due again for the test
    await withOrgContext(pool, orgId, (c) =>
      c.query(
        `UPDATE campaign_leads SET next_send_at = now() WHERE current_step = 0`,
      ),
    );
    const second = await http()
      .post('/sending/tick')
      .set('Authorization', auth())
      .expect(200);
    expect(second.body.sent).toBe(5);
  });
});
