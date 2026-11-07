/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-return */
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'crypto';
import { Pool } from 'pg';
import request from 'supertest';
import { AppModule } from '../app.module';
import { PG_POOL } from '../db/db.module';
import { withOrgContext } from '../db/tenant-context';
import { GmailAuthError } from '../senders/providers/gmail.provider';
import { SendersService } from '../senders/senders.service';
import { verifyAllSenders } from '../../test/verify-senders';

/** Campaigns send only from verified senders; a sender whose access breaks
 *  mid-send leaves the lead waiting instead of skipping its step. */
describe('Sender eligibility (send engine)', () => {
  let app: INestApplication;
  let pool: Pool;
  let token: string;
  let orgId: string;
  let userId: string;
  const auth = () => `Bearer ${token}`;
  const http = () => request(app.getHttpServer());
  const tick = async () =>
    (
      await http()
        .post('/sending/tick')
        .set('Authorization', auth())
        .expect(200)
    ).body;
  const enrollment = async () =>
    withOrgContext(pool, orgId, async (c) => {
      const r = await c.query(
        `SELECT status, current_step, next_send_at FROM campaign_leads`,
      );
      return r.rows[0];
    });

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
        email: `se-${randomUUID().slice(0, 8)}@test.local`,
        password: 'se-pass-123',
        name: 'SE',
        orgName: 'SE Org',
      })
      .expect(201);
    token = res.body.accessToken;
    orgId = res.body.org.id;
    userId = res.body.user.id;

    await http()
      .post('/senders')
      .set('Authorization', auth())
      .send({ provider: 'smtp', fromName: 'Rep', fromEmail: 'rep@se.local' })
      .expect(201);
    await http()
      .post('/leads')
      .set('Authorization', auth())
      .send({ email: 'lee@se.local', firstName: 'Lee' })
      .expect(201);
    const tpls = await http().get('/templates').set('Authorization', auth());
    const camp = await http()
      .post('/campaigns')
      .set('Authorization', auth())
      .send({ name: 'Eligibility' })
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
  });

  afterAll(async () => {
    await withOrgContext(pool, orgId, async (c) => {
      await c.query(`DELETE FROM orgs WHERE id = $1`, [orgId]);
    });
    await pool.query(`DELETE FROM users WHERE id = $1`, [userId]);
    await app.close();
  });

  it('an unverified sender never sends; the lead waits on step one', async () => {
    const t = await tick();
    expect(t).toMatchObject({ sent: 0, failed: 0, deferred: 1 });
    expect(await enrollment()).toMatchObject({
      status: 'active',
      current_step: 0,
    });
  });

  it('a sender whose access breaks mid-send leaves the lead on its step', async () => {
    await verifyAllSenders(app.getHttpServer(), auth());
    const spy = jest
      .spyOn(app.get(SendersService), 'sendMessage')
      .mockRejectedValueOnce(new GmailAuthError('Google access was revoked'));
    // the lease from the deferred tick above may still hold the lead
    await withOrgContext(pool, orgId, (c) =>
      c.query(`UPDATE campaign_leads SET next_send_at = now()`),
    );

    const t = await tick();
    expect(t).toMatchObject({ sent: 0, failed: 0, deferred: 1 });
    const e = await enrollment();
    expect(e).toMatchObject({ status: 'active', current_step: 0 });
    expect(new Date(e.next_send_at).getTime()).toBeGreaterThan(
      Date.now() + 10 * 60_000,
    );
    await withOrgContext(pool, orgId, async (c) => {
      const r = await c.query(`SELECT status, error FROM sent_emails`);
      expect(r.rows).toEqual([
        { status: 'failed', error: 'Google access was revoked' },
      ]);
    });
    spy.mockRestore();

    // once the sender works again, the same step goes out
    await withOrgContext(pool, orgId, (c) =>
      c.query(`UPDATE campaign_leads SET next_send_at = now()`),
    );
    expect(await tick()).toMatchObject({ sent: 1 });
    expect(await enrollment()).toMatchObject({
      status: 'active',
      current_step: 1,
    });
  });
});
