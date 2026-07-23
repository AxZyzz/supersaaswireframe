/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument */
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'crypto';
import { Pool } from 'pg';
import request from 'supertest';
import { AppModule } from '../app.module';
import { PG_POOL } from '../db/db.module';
import { withOrgContext } from '../db/tenant-context';

/** Sender accounts CRUD + live DNS SPF/DMARC checks. */
describe('Senders integration', () => {
  let app: INestApplication;
  let pool: Pool;
  let token: string;
  let orgId: string;
  let userId: string;

  const jwt = () => ({ Authorization: `Bearer ${token}` });

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
    const email = `snd-${randomUUID().slice(0, 8)}@test.local`;
    const res = await request(app.getHttpServer())
      .post('/auth/signup')
      .send({ email, password: 'snd-pass-1', name: 'S', orgName: 'Snd Org' })
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

  let senderId: string;

  it('creates, lists, updates, deletes a sender account', async () => {
    const created = await request(app.getHttpServer())
      .post('/senders')
      .set(jwt())
      .send({
        provider: 'ses',
        fromName: 'Sales',
        fromEmail: 'Sales@Acme.com',
        dailyLimit: 100,
      })
      .expect(201);
    expect(created.body.status).toBe('unverified');
    expect(created.body.from_email).toBe('sales@acme.com'); // normalized
    expect(created.body.daily_limit).toBe(100);
    senderId = created.body.id;

    const list = await request(app.getHttpServer())
      .get('/senders')
      .set(jwt())
      .expect(200);
    expect(list.body).toHaveLength(1);

    const updated = await request(app.getHttpServer())
      .patch(`/senders/${senderId}`)
      .set(jwt())
      .send({ dailyLimit: 250, replyTo: 'reply@acme.com' })
      .expect(200);
    expect(updated.body.daily_limit).toBe(250);
    expect(updated.body.reply_to).toBe('reply@acme.com');

    await request(app.getHttpServer())
      .delete(`/senders/${senderId}`)
      .set(jwt())
      .expect(200);
    const after = await request(app.getHttpServer())
      .get('/senders')
      .set(jwt())
      .expect(200);
    expect(after.body).toHaveLength(0);
  });

  it('rejects a duplicate sender email (case-insensitive)', async () => {
    await request(app.getHttpServer())
      .post('/senders')
      .set(jwt())
      .send({ provider: 'smtp', fromName: 'A', fromEmail: 'dup@acme.com' })
      .expect(201);
    await request(app.getHttpServer())
      .post('/senders')
      .set(jwt())
      .send({ provider: 'gmail', fromName: 'B', fromEmail: 'DUP@acme.com' })
      .expect(409);
  });

  it('runs a live DNS check (google.com has SPF + DMARC)', async () => {
    const res = await request(app.getHttpServer())
      .get('/senders/dns-check?domain=google.com')
      .set(jwt())
      .expect(200);
    expect(res.body.domain).toBe('google.com');
    expect(res.body.spf.found).toBe(true);
    expect(res.body.spf.record).toMatch(/v=spf1/i);
    expect(res.body.dmarc.found).toBe(true);
    // DKIM is selector-specific → always guidance, never "found"
    expect(res.body.dkim.found).toBe(false);
  });

  it('DNS check reports missing records for a nonexistent domain', async () => {
    const res = await request(app.getHttpServer())
      .get(`/senders/dns-check?domain=nx-${randomUUID().slice(0, 12)}.invalid`)
      .set(jwt())
      .expect(200);
    expect(res.body.spf.found).toBe(false);
    expect(res.body.dmarc.found).toBe(false);
  });

  it('agent cannot create a sender (admin/manager only)', async () => {
    const s = await request(app.getHttpServer())
      .post('/auth/signup')
      .send({
        email: `snda-${randomUUID().slice(0, 8)}@test.local`,
        password: 'snd-pass-1',
        name: 'SA',
        orgName: 'SA Own',
      })
      .expect(201);
    const agentUserId = s.body.user.id;
    const agentOwn = s.body.org.id;
    await withOrgContext(pool, orgId, async (c) => {
      await c.query(
        `INSERT INTO memberships (org_id, user_id, role) VALUES ($1, $2, 'agent')`,
        [orgId, agentUserId],
      );
    });
    const sw = await request(app.getHttpServer())
      .post('/auth/switch-org')
      .set('Authorization', `Bearer ${s.body.accessToken}`)
      .send({ orgId })
      .expect(200);
    await request(app.getHttpServer())
      .post('/senders')
      .set('Authorization', `Bearer ${sw.body.accessToken}`)
      .send({ provider: 'ses', fromName: 'X', fromEmail: 'x@nope.com' })
      .expect(403);

    await withOrgContext(pool, agentOwn, async (c) => {
      await c.query(`DELETE FROM orgs WHERE id = $1`, [agentOwn]);
    });
    await withOrgContext(pool, orgId, async (c) => {
      await c.query(`DELETE FROM memberships WHERE user_id = $1`, [
        agentUserId,
      ]);
    });
    await pool.query(`DELETE FROM users WHERE id = $1`, [agentUserId]);
  });
});
