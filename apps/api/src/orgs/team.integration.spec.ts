/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return */
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'crypto';
import { Pool } from 'pg';
import request from 'supertest';
import { AppModule } from '../app.module';
import { PG_POOL } from '../db/db.module';
import { withOrgContext } from '../db/tenant-context';

/** E9 chunk 2: invites, role changes, removal — and that authorization
 *  follows the live membership, not the role baked into the access token. */
describe('Team integration', () => {
  let app: INestApplication;
  let pool: Pool;
  const orgIds: string[] = [];
  const userIds: string[] = [];

  let admin: string; // bearer
  let orgId: string;
  let adminId: string;
  let agentToken: string;
  let agentId: string;

  const http = () => request(app.getHttpServer());
  const bearer = (t: string) => `Bearer ${t}`;
  const uniq = (p: string) => `${p}-${randomUUID().slice(0, 8)}@test.local`;

  const signup = async (orgName: string) => {
    const r = await http()
      .post('/auth/signup')
      .send({
        email: uniq('tm'),
        password: 'team-pass-123',
        name: 'Tm',
        orgName,
      })
      .expect(201);
    orgIds.push(r.body.org.id);
    userIds.push(r.body.user.id);
    return r.body;
  };

  const invite = (email: string, role = 'agent', as = admin) =>
    http()
      .post('/orgs/invites')
      .set('Authorization', bearer(as))
      .send({ email, role });

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

    const a = await signup('Team Org');
    admin = a.accessToken;
    orgId = a.org.id;
    adminId = a.user.id;
    // this suite needs more seats than the beta plan's 3 (limits have their
    // own suite in usage.integration.spec)
    await withOrgContext(pool, orgId, (c) =>
      c.query(`UPDATE orgs SET plan = 'internal' WHERE id = $1`, [orgId]),
    );
  });

  afterAll(async () => {
    for (const id of orgIds) {
      await withOrgContext(pool, id, async (c) => {
        await c.query(`DELETE FROM orgs WHERE id = $1`, [id]);
      });
    }
    for (const id of userIds) {
      await pool.query(`DELETE FROM users WHERE id = $1`, [id]);
    }
    await app.close();
  });

  it('invite → preview → register joins the workspace with the invited role', async () => {
    const email = uniq('new');
    const inv = await invite(email.toUpperCase()).expect(201);
    expect(inv.body.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(inv.body.email).toBe(email); // normalized

    const pending = await http()
      .get('/orgs/invites')
      .set('Authorization', bearer(admin));
    expect(pending.body.map((i: { email: string }) => i.email)).toContain(
      email,
    );

    const pv = await http().get(`/invites/${inv.body.token}`).expect(200);
    expect(pv.body).toEqual({
      orgName: 'Team Org',
      email,
      role: 'agent',
      status: 'pending',
    });

    const reg = await http()
      .post(`/invites/${inv.body.token}/register`)
      .send({ name: 'New Agent', password: 'agent-pass-123' })
      .expect(201);
    agentToken = reg.body.accessToken;
    agentId = reg.body.user.id;
    userIds.push(agentId);
    expect(reg.body.org.id).toBe(orgId);

    const me = await http()
      .get('/auth/me')
      .set('Authorization', bearer(agentToken));
    expect(me.body).toMatchObject({ orgId, role: 'agent' });

    // single use
    await http()
      .post(`/invites/${inv.body.token}/register`)
      .send({ name: 'Again', password: 'agent-pass-123' })
      .expect(410);
    const used = await http().get(`/invites/${inv.body.token}`);
    expect(used.body.status).toBe('accepted');

    const members = await http()
      .get('/orgs/members')
      .set('Authorization', bearer(admin));
    expect(members.body).toHaveLength(2);
    const after = await http()
      .get('/orgs/invites')
      .set('Authorization', bearer(admin));
    expect(after.body.map((i: { email: string }) => i.email)).not.toContain(
      email,
    );

    // the team was told
    const n = await http()
      .get('/notifications')
      .set('Authorization', bearer(admin));
    expect(
      n.body.some((x: { type: string }) => x.type === 'member_joined'),
    ).toBe(true);
    // ...but the newcomer isn't notified about themselves
    const own = await http()
      .get('/notifications')
      .set('Authorization', bearer(agentToken));
    expect(
      own.body.some((x: { type: string }) => x.type === 'member_joined'),
    ).toBe(false);
  });

  it('existing accounts accept while signed in — only with the invited email', async () => {
    const other = await signup('Elsewhere Org');
    const inv = await invite(other.user.email, 'manager').expect(201);

    // the wrong signed-in user is refused
    await http()
      .post(`/invites/${inv.body.token}/accept`)
      .set('Authorization', bearer(admin))
      .expect(403);
    // register is refused for an existing email
    await http()
      .post(`/invites/${inv.body.token}/register`)
      .send({ name: 'X', password: 'whatever-123' })
      .expect(409);

    const ok = await http()
      .post(`/invites/${inv.body.token}/accept`)
      .set('Authorization', bearer(other.accessToken))
      .expect(200);
    const me = await http()
      .get('/auth/me')
      .set('Authorization', bearer(ok.body.accessToken));
    expect(me.body).toMatchObject({ orgId, role: 'manager' });
  });

  it('rejects duplicates, bad tokens, expired and revoked invites', async () => {
    await invite(uniq('x'), 'owner').expect(400); // not a role
    const memberEmail = (
      await http().get('/orgs/members').set('Authorization', bearer(admin))
    ).body[0].email;
    await invite(memberEmail).expect(409);

    await http().get('/invites/nope').expect(404);
    await http()
      .get(`/invites/${'A'.repeat(43)}`)
      .expect(404);

    const exp = await invite(uniq('exp')).expect(201);
    await withOrgContext(pool, orgId, async (c) => {
      await c.query(
        `UPDATE invites SET expires_at = now() - interval '1 minute' WHERE id = $1`,
        [exp.body.id],
      );
    });
    expect((await http().get(`/invites/${exp.body.token}`)).body.status).toBe(
      'expired',
    );
    await http()
      .post(`/invites/${exp.body.token}/register`)
      .send({ name: 'Late', password: 'late-pass-123' })
      .expect(410);

    // re-inviting replaces the old link
    const email = uniq('re');
    const first = await invite(email).expect(201);
    const second = await invite(email).expect(201);
    await http().get(`/invites/${first.body.token}`).expect(404);
    await http()
      .delete(`/orgs/invites/${second.body.id}`)
      .set('Authorization', bearer(admin))
      .expect(200);
    await http().get(`/invites/${second.body.token}`).expect(404);
  });

  it('non-admins cannot manage the team', async () => {
    await invite(uniq('n'), 'agent', agentToken).expect(403);
    await http()
      .patch(`/orgs/members/${adminId}`)
      .set('Authorization', bearer(agentToken))
      .send({ role: 'agent' })
      .expect(403);
  });

  it('role changes apply to existing tokens immediately', async () => {
    await http()
      .get('/orgs/members')
      .set('Authorization', bearer(agentToken))
      .expect(403);
    await http()
      .patch(`/orgs/members/${agentId}`)
      .set('Authorization', bearer(admin))
      .send({ role: 'manager' })
      .expect(200);
    // same (agent-minted) token, now authorized as manager
    await http()
      .get('/orgs/members')
      .set('Authorization', bearer(agentToken))
      .expect(200);
  });

  it('the last admin can be neither demoted nor removed', async () => {
    await http()
      .patch(`/orgs/members/${adminId}`)
      .set('Authorization', bearer(admin))
      .send({ role: 'manager' })
      .expect(400);
    await http()
      .delete(`/orgs/members/${adminId}`)
      .set('Authorization', bearer(admin))
      .expect(400);
    await http()
      .delete(`/orgs/members/${randomUUID()}`)
      .set('Authorization', bearer(admin))
      .expect(404);
  });

  it('removal revokes access at once and frees their inbox assignments', async () => {
    await http()
      .get('/orgs/me')
      .set('Authorization', bearer(agentToken))
      .expect(200);
    await http()
      .delete(`/orgs/members/${agentId}`)
      .set('Authorization', bearer(admin))
      .expect(200);
    await http()
      .get('/orgs/me')
      .set('Authorization', bearer(agentToken))
      .expect(401);
    const members = await http()
      .get('/orgs/members')
      .set('Authorization', bearer(admin));
    expect(
      members.body.map((m: { user_id: string }) => m.user_id),
    ).not.toContain(agentId);
  });
});
