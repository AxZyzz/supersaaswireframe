/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument */
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'crypto';
import { Pool } from 'pg';
import request from 'supertest';
import { AppModule } from '../app.module';
import { PG_POOL } from '../db/db.module';
import { withOrgContext } from '../db/tenant-context';

/**
 * End-to-end auth + authz flow against the real DB (RLS active).
 * Covers: signup, JWT guard, org context, refresh rotation + reuse detection,
 * role guard, cross-org token isolation.
 */
describe('Auth integration', () => {
  let app: INestApplication;
  let pool: Pool;
  const email = `auth-int-${randomUUID().slice(0, 8)}@test.local`;
  const password = 'correct-horse-42';
  let accessToken: string;
  let refreshToken: string;
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
  });

  afterAll(async () => {
    if (orgId) {
      await withOrgContext(pool, orgId, async (c) => {
        await c.query(`DELETE FROM orgs WHERE id = $1`, [orgId]);
      });
    }
    if (userId) {
      await pool.query(`DELETE FROM users WHERE id = $1`, [userId]);
    }
    await app.close();
  });

  it('signs up: creates user + org + admin membership, returns tokens', async () => {
    const res = await request(app.getHttpServer())
      .post('/auth/signup')
      .send({ email, password, name: 'Int Test', orgName: 'Int Test Org' })
      .expect(201);
    expect(res.body.accessToken).toBeDefined();
    expect(res.body.refreshToken).toBeDefined();
    expect(res.body.org.id).toBeDefined();
    accessToken = res.body.accessToken;
    refreshToken = res.body.refreshToken;
    orgId = res.body.org.id;
    userId = res.body.user.id;
  });

  it('rejects unauthenticated /auth/me', async () => {
    await request(app.getHttpServer()).get('/auth/me').expect(401);
  });

  it('serves /auth/me and /orgs/me with the access token', async () => {
    const me = await request(app.getHttpServer())
      .get('/auth/me')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);
    expect(me.body).toEqual({ userId, orgId, role: 'admin' });

    const org = await request(app.getHttpServer())
      .get('/orgs/me')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);
    expect(org.body.id).toBe(orgId);
  });

  it('lists members for admin via RLS-scoped query', async () => {
    const res = await request(app.getHttpServer())
      .get('/orgs/members')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].user_id).toBe(userId);
    expect(res.body[0].role).toBe('admin');
  });

  it('rejects a refresh token used as access token', async () => {
    await request(app.getHttpServer())
      .get('/auth/me')
      .set('Authorization', `Bearer ${refreshToken}`)
      .expect(401);
  });

  it('rotates refresh tokens and detects reuse', async () => {
    const first = await request(app.getHttpServer())
      .post('/auth/refresh')
      .send({ refreshToken })
      .expect(200);
    const rotated = first.body.refreshToken;
    expect(rotated).not.toBe(refreshToken);

    // Re-presenting it seconds later (parallel requests / two tabs racing)
    // is refused but NOT treated as theft — the rotated token keeps working.
    await request(app.getHttpServer())
      .post('/auth/refresh')
      .send({ refreshToken })
      .expect(401);
    const again = await request(app.getHttpServer())
      .post('/auth/refresh')
      .send({ refreshToken: rotated })
      .expect(200);
    const newest = again.body.refreshToken;

    // Replaying a token rotated out long ago IS theft: the family is revoked.
    await pool.query(
      `UPDATE refresh_tokens SET revoked_at = now() - interval '5 minutes'
       WHERE user_id = $1 AND revoked_at IS NOT NULL`,
      [userId],
    );
    await request(app.getHttpServer())
      .post('/auth/refresh')
      .send({ refreshToken })
      .expect(401);

    // Family revoked → even the newest token is now dead.
    await request(app.getHttpServer())
      .post('/auth/refresh')
      .send({ refreshToken: newest })
      .expect(401);

    // Fresh login recovers.
    const login = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email, password })
      .expect(200);
    accessToken = login.body.accessToken;
    refreshToken = login.body.refreshToken;
  });

  it('blocks switch-org to an org the user is not a member of', async () => {
    await request(app.getHttpServer())
      .post('/auth/switch-org')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ orgId: randomUUID() })
      .expect(401);
  });

  it('enforces role guard: agent cannot list members', async () => {
    // Second user signs up with their own org, then gets an agent membership
    // in OUR org via direct insert (invite flow lands later).
    const agentEmail = `agent-${randomUUID().slice(0, 8)}@test.local`;
    const signup = await request(app.getHttpServer())
      .post('/auth/signup')
      .send({
        email: agentEmail,
        password,
        name: 'Agent User',
        orgName: 'Agent Own Org',
      })
      .expect(201);
    const agentUserId = signup.body.user.id;
    const agentOwnOrg = signup.body.org.id;

    await withOrgContext(pool, orgId, async (c) => {
      await c.query(
        `INSERT INTO memberships (org_id, user_id, role) VALUES ($1, $2, 'agent')`,
        [orgId, agentUserId],
      );
    });

    // switch-org into our org as agent
    const switched = await request(app.getHttpServer())
      .post('/auth/switch-org')
      .set('Authorization', `Bearer ${signup.body.accessToken}`)
      .send({ orgId })
      .expect(200);

    await request(app.getHttpServer())
      .get('/orgs/members')
      .set('Authorization', `Bearer ${switched.body.accessToken}`)
      .expect(403);

    // cleanup second user
    await withOrgContext(pool, agentOwnOrg, async (c) => {
      await c.query(`DELETE FROM orgs WHERE id = $1`, [agentOwnOrg]);
    });
    await withOrgContext(pool, orgId, async (c) => {
      await c.query(`DELETE FROM memberships WHERE user_id = $1`, [
        agentUserId,
      ]);
    });
    await pool.query(`DELETE FROM users WHERE id = $1`, [agentUserId]);
  });
});
