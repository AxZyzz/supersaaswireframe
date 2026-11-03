/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-call */
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'crypto';
import { Pool } from 'pg';
import request from 'supertest';
import { AppModule } from '../../app.module';
import { PG_POOL } from '../../db/db.module';
import { withOrgContext } from '../../db/tenant-context';

/** API-key management + the public /v1/leads REST surface. */
describe('Public API integration', () => {
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
    const email = `api-${randomUUID().slice(0, 8)}@test.local`;
    const res = await request(app.getHttpServer())
      .post('/auth/signup')
      .send({ email, password: 'api-pass-1', name: 'A', orgName: 'API Org' })
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

  const jwt = () => ({ Authorization: `Bearer ${token}` });
  let rawKey: string;
  let keyId: string;

  it('creates an API key, returning the raw key once', async () => {
    const res = await request(app.getHttpServer())
      .post('/api-keys')
      .set(jwt())
      .send({ name: 'Zapier' })
      .expect(201);
    expect(res.body.key).toMatch(/^ssk_[a-f0-9]{48}$/);
    expect(res.body.prefix).toBe(res.body.key.slice(0, 12));
    rawKey = res.body.key;
    keyId = res.body.id;

    // list never exposes the raw key or its hash
    const list = await request(app.getHttpServer())
      .get('/api-keys')
      .set(jwt())
      .expect(200);
    expect(list.body).toHaveLength(1);
    expect(list.body[0].key).toBeUndefined();
    expect(list.body[0].prefix).toBe(rawKey.slice(0, 12));
  });

  it('rejects /v1/leads without a key and with a bad key', async () => {
    await request(app.getHttpServer())
      .post('/v1/leads')
      .send({ email: 'x@y.com' })
      .expect(401);
    await request(app.getHttpServer())
      .post('/v1/leads')
      .set('X-Api-Key', 'ssk_not_a_real_key')
      .send({ email: 'x@y.com' })
      .expect(401);
  });

  it('upserts a lead via the public API (create then update)', async () => {
    const created = await request(app.getHttpServer())
      .post('/v1/leads')
      .set('X-Api-Key', rawKey)
      .send({ email: 'lead@ext.com', firstName: 'Ext', company: 'ExtCo' })
      .expect(200);
    expect(created.body.created).toBe(true);
    expect(created.body.lead.source).toBe('api');

    const updated = await request(app.getHttpServer())
      .post('/v1/leads')
      .set('X-Api-Key', rawKey)
      .send({ email: 'LEAD@ext.com', company: 'ExtCo2' })
      .expect(200);
    expect(updated.body.created).toBe(false);
    expect(updated.body.lead.company).toBe('ExtCo2');

    // the lead is visible in the JWT-scoped org list (only one, deduped)
    const list = await request(app.getHttpServer())
      .get('/leads?search=ext')
      .set(jwt())
      .expect(200);
    expect(list.body.total).toBe(1);
  });

  it("enforces each key's own rate limit (T2.9)", async () => {
    const mk = (name: string, rateLimitPerMin?: number) =>
      request(app.getHttpServer())
        .post('/api-keys')
        .set(jwt())
        .send({ name, rateLimitPerMin })
        .expect(201);
    const tight = await mk('Tight', 2);
    const other = await mk('Other');
    expect(tight.body.rate_limit_per_min).toBe(2);
    expect(other.body.rate_limit_per_min).toBe(120);

    const call = (key: string) =>
      request(app.getHttpServer())
        .post('/v1/leads')
        .set('X-Api-Key', key)
        .send({ email: 'rl@ext.com' });
    const first = await call(tight.body.key).expect(200);
    expect(first.headers['x-ratelimit-limit']).toBe('2');
    expect(first.headers['x-ratelimit-remaining']).toBe('1');
    await call(tight.body.key).expect(200);
    const blocked = await call(tight.body.key).expect(429);
    expect(Number(blocked.headers['retry-after'])).toBeGreaterThan(0);

    // budgets are per key, not per caller
    await call(other.body.key).expect(200);

    // invalid budgets are rejected; a valid one is stored
    await request(app.getHttpServer())
      .patch(`/api-keys/${tight.body.id}`)
      .set(jwt())
      .send({ rateLimitPerMin: 0 })
      .expect(400);
    const raised = await request(app.getHttpServer())
      .patch(`/api-keys/${tight.body.id}`)
      .set(jwt())
      .send({ rateLimitPerMin: 600 })
      .expect(200);
    expect(raised.body.rate_limit_per_min).toBe(600);

    for (const k of [tight, other]) {
      await request(app.getHttpServer())
        .delete(`/api-keys/${k.body.id}`)
        .set(jwt())
        .expect(200);
    }
  });

  it('revoked key no longer works', async () => {
    await request(app.getHttpServer())
      .delete(`/api-keys/${keyId}`)
      .set(jwt())
      .expect(200);
    await request(app.getHttpServer())
      .post('/v1/leads')
      .set('X-Api-Key', rawKey)
      .send({ email: 'again@ext.com' })
      .expect(401);
  });

  it('agent cannot manage API keys (admin/manager only)', async () => {
    const s = await request(app.getHttpServer())
      .post('/auth/signup')
      .send({
        email: `aa-${randomUUID().slice(0, 8)}@test.local`,
        password: 'api-pass-1',
        name: 'AA',
        orgName: 'AA Own',
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
      .post('/api-keys')
      .set('Authorization', `Bearer ${sw.body.accessToken}`)
      .send({ name: 'nope' })
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
