/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-call */
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'crypto';
import { Pool } from 'pg';
import request from 'supertest';
import { AppModule } from '../app.module';
import { PG_POOL } from '../db/db.module';
import { withOrgContext } from '../db/tenant-context';
import { MockProvider } from '../senders/providers/mock.provider';
import { verifyAllSenders } from '../../test/verify-senders';

/** T10.6: CAN-SPAM footer, GDPR erasure of a lead, workspace export,
 *  workspace deletion and self-service account deletion. */
describe('Compliance integration', () => {
  let app: INestApplication;
  let pool: Pool;
  const http = () => request(app.getHttpServer());
  const bearer = (t: string) => `Bearer ${t}`;
  const uniq = (p: string) => `${p}-${randomUUID().slice(0, 8)}@test.local`;
  const cleanupUsers: string[] = [];
  const cleanupOrgs: string[] = [];

  const signup = async (orgName: string) => {
    const email = uniq('cmp');
    const r = await http()
      .post('/auth/signup')
      .send({ email, password: 'cmp-pass-123', name: 'Cmp', orgName })
      .expect(201);
    cleanupUsers.push(r.body.user.id);
    cleanupOrgs.push(r.body.org.id);
    return { ...r.body, email } as {
      accessToken: string;
      refreshToken: string;
      org: { id: string; name: string };
      user: { id: string };
      email: string;
    };
  };

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
    for (const id of cleanupOrgs) {
      await withOrgContext(pool, id, (c) =>
        c.query(`DELETE FROM orgs WHERE id = $1`, [id]),
      );
    }
    for (const id of cleanupUsers) {
      await pool.query(`DELETE FROM users WHERE id = $1`, [id]);
    }
    await app.close();
  });

  it('campaign emails carry the postal address; missing one raises an alert', async () => {
    const a = await signup('Footer Co');
    const auth = bearer(a.accessToken);

    let ov = await http().get('/analytics/overview').set('Authorization', auth);
    expect(ov.body.alerts.map((x: { kind: string }) => x.kind)).toContain(
      'missing_postal_address',
    );

    await http()
      .patch('/orgs/me')
      .set('Authorization', auth)
      .send({ postalAddress: '221B Baker Street, London NW1 6XE' })
      .expect(200);
    ov = await http().get('/analytics/overview').set('Authorization', auth);
    expect(ov.body.alerts.map((x: { kind: string }) => x.kind)).not.toContain(
      'missing_postal_address',
    );

    await http()
      .post('/senders')
      .set('Authorization', auth)
      .send({
        provider: 'smtp',
        fromName: 'Rep',
        fromEmail: 'rep@footer.local',
      })
      .expect(201);
    await verifyAllSenders(app.getHttpServer(), auth);
    const to = uniq('lead');
    await http()
      .post('/leads')
      .set('Authorization', auth)
      .send({ email: to })
      .expect(201);
    const tpls = await http().get('/templates').set('Authorization', auth);
    const camp = await http()
      .post('/campaigns')
      .set('Authorization', auth)
      .send({ name: 'Footer' })
      .expect(201);
    await http()
      .post(`/campaigns/${camp.body.id}/steps`)
      .set('Authorization', auth)
      .send({ templateId: tpls.body[0].id, delayHours: 0 })
      .expect(201);
    await http()
      .post(`/campaigns/${camp.body.id}/enroll`)
      .set('Authorization', auth)
      .expect(200);
    await http().post('/sending/tick').set('Authorization', auth).expect(200);

    const msg = [...MockProvider.outbox].reverse().find((m) => m.to === to);
    expect(msg).toBeDefined();
    expect(msg!.html).toContain(
      'Footer Co · 221B Baker Street, London NW1 6XE',
    );
    expect(msg!.html).toMatch(/Unsubscribe<\/a>/);
    expect(msg!.headers?.['List-Unsubscribe-Post']).toBe(
      'List-Unsubscribe=One-Click',
    );
  });

  it('forgetting a lead deletes it but suppresses the address', async () => {
    const a = await signup('Erasure Co');
    const auth = bearer(a.accessToken);
    const email = uniq('forget-me');
    const lead = await http()
      .post('/leads')
      .set('Authorization', auth)
      .send({ email })
      .expect(201);

    await http()
      .delete(`/leads/${lead.body.id}?forget=true`)
      .set('Authorization', auth)
      .expect(200);
    await withOrgContext(pool, a.org.id, async (c) => {
      const l = await c.query(
        `SELECT 1 FROM leads WHERE lower(email) = lower($1)`,
        [email],
      );
      expect(l.rowCount).toBe(0);
      const s = await c.query(
        `SELECT reason FROM suppression_list WHERE lower(email) = lower($1)`,
        [email],
      );
      expect(s.rows[0]?.reason).toBe('erasure');
    });
  });

  it('exports the workspace as JSON without secrets', async () => {
    const a = await signup('Export Co');
    const auth = bearer(a.accessToken);
    await http()
      .post('/leads')
      .set('Authorization', auth)
      .send({ email: uniq('x') })
      .expect(201);
    const r = await http()
      .get('/orgs/me/export')
      .set('Authorization', auth)
      .expect(200);
    expect(r.headers['content-disposition']).toMatch(/attachment/);
    expect(r.body.workspace.name).toBe('Export Co');
    expect(r.body.leads).toHaveLength(1);
    expect(r.body.members[0].email).toBe(a.email);
    const blob = JSON.stringify(r.body);
    expect(blob).not.toMatch(/password_hash|passEnc|token_hash/);
  });

  it('deletes a workspace only with the exact name, removing now-empty accounts', async () => {
    const a = await signup('Doomed Co');
    const auth = bearer(a.accessToken);
    await http()
      .delete('/orgs/me')
      .set('Authorization', auth)
      .send({ confirmName: 'doomed co' })
      .expect(400);

    const r = await http()
      .delete('/orgs/me')
      .set('Authorization', auth)
      .send({ confirmName: 'Doomed Co' })
      .expect(200);
    expect(r.body).toEqual({ deleted: true, accountsRemoved: 1 });
    const u = await pool.query(`SELECT 1 FROM users WHERE id = $1`, [
      a.user.id,
    ]);
    expect(u.rowCount).toBe(0);
    // the old token is dead immediately
    await http().get('/orgs/me').set('Authorization', auth).expect(401);
  });

  it('account deletion: password re-check, last-admin guard, solo workspaces go too', async () => {
    const owner = await signup('Shared Co');
    const ownerAuth = bearer(owner.accessToken);
    // a second member makes the owner the "only admin of a shared workspace"
    const inv = await http()
      .post('/orgs/invites')
      .set('Authorization', ownerAuth)
      .send({ email: uniq('mate'), role: 'agent' })
      .expect(201);
    const mate = await http()
      .post(`/invites/${inv.body.token}/register`)
      .send({ name: 'Mate', password: 'mate-pass-123' })
      .expect(201);
    cleanupUsers.push(mate.body.user.id);

    await http()
      .delete('/auth/me')
      .set('Authorization', ownerAuth)
      .send({ password: 'wrong-password' })
      .expect(401);
    const blocked = await http()
      .delete('/auth/me')
      .set('Authorization', ownerAuth)
      .send({ password: 'cmp-pass-123' })
      .expect(400);
    expect(blocked.body.message).toMatch(/only admin of "Shared Co"/);

    // the agent can leave freely; the workspace stays
    const left = await http()
      .delete('/auth/me')
      .set('Authorization', bearer(mate.body.accessToken))
      .send({ password: 'mate-pass-123' })
      .expect(200);
    expect(left.body).toEqual({ deleted: true, workspacesDeleted: 0 });

    // now the owner is alone, so deleting the account takes the workspace too
    const gone = await http()
      .delete('/auth/me')
      .set('Authorization', ownerAuth)
      .send({ password: 'cmp-pass-123' })
      .expect(200);
    expect(gone.body).toEqual({ deleted: true, workspacesDeleted: 1 });
    const org = await pool.query(`SELECT 1 FROM user_memberships($1)`, [
      owner.user.id,
    ]);
    expect(org.rowCount).toBe(0);
    await http().get('/auth/me').set('Authorization', ownerAuth).expect(401);
  });
});
