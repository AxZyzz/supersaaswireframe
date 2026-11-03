/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return */
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'crypto';
import { Pool } from 'pg';
import request from 'supertest';
import { AppModule } from '../app.module';
import { PG_POOL } from '../db/db.module';
import { withOrgContext } from '../db/tenant-context';

/** T8.6: the A2B operator console sees every workspace, but only operators. */
describe('Operator console integration', () => {
  let app: INestApplication;
  let pool: Pool;
  const http = () => request(app.getHttpServer());
  const bearer = (t: string) => `Bearer ${t}`;
  const users: string[] = [];
  const orgs: string[] = [];
  let opToken: string;
  let custToken: string;
  let custOrg: string;

  const signup = async (orgName: string) => {
    const r = await http()
      .post('/auth/signup')
      .send({
        email: `op-${randomUUID().slice(0, 8)}@test.local`,
        password: 'op-pass-123',
        name: 'Op',
        orgName,
      })
      .expect(201);
    users.push(r.body.user.id);
    orgs.push(r.body.org.id);
    return r.body;
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

    const op = await signup('A2B HQ');
    opToken = op.accessToken;
    // operators are granted out-of-band (CLI), never via the API
    await pool.query(`UPDATE users SET is_operator = true WHERE id = $1`, [
      op.user.id,
    ]);

    const cust = await signup('Customer Co');
    custToken = cust.accessToken;
    custOrg = cust.org.id;
    await http()
      .post('/leads')
      .set('Authorization', bearer(custToken))
      .send({ email: 'someone@customer.local' })
      .expect(201);
    // a failed send so the failures feed has something to mask
    await withOrgContext(pool, custOrg, (c) =>
      c.query(
        `INSERT INTO sent_emails (org_id, to_email, subject, status, error, tracking_id)
         VALUES ($1, 'jane.doe@customer.local', 'Hi', 'failed', 'SMTP 550 mailbox unavailable', $2)`,
        [custOrg, randomUUID()],
      ),
    );
  });

  afterAll(async () => {
    for (const id of orgs) {
      await withOrgContext(pool, id, (c) =>
        c.query(`DELETE FROM orgs WHERE id = $1`, [id]),
      );
    }
    for (const id of users)
      await pool.query(`DELETE FROM users WHERE id = $1`, [id]);
    await app.close();
  });

  it('workspace admins (non-operators) are refused everywhere', async () => {
    for (const path of [
      '/operator/overview',
      '/operator/orgs',
      '/operator/failures',
      '/operator/health',
    ]) {
      await http()
        .get(path)
        .set('Authorization', bearer(custToken))
        .expect(403);
    }
    const me = await http()
      .get('/auth/me')
      .set('Authorization', bearer(custToken));
    expect(me.body.isOperator).toBe(false);
  });

  it('operators see platform totals and every workspace', async () => {
    const me = await http()
      .get('/auth/me')
      .set('Authorization', bearer(opToken));
    expect(me.body.isOperator).toBe(true);

    const ov = await http()
      .get('/operator/overview')
      .set('Authorization', bearer(opToken))
      .expect(200);
    expect(ov.body.totals.orgs).toBeGreaterThanOrEqual(2);
    expect(ov.body.daily).toHaveLength(14);

    const list = await http()
      .get('/operator/orgs')
      .set('Authorization', bearer(opToken))
      .expect(200);
    const cust = list.body.find((o: { id: string }) => o.id === custOrg);
    expect(cust).toMatchObject({
      name: 'Customer Co',
      plan: 'beta',
      members: 1,
      leads: 1,
      failed_7d: 1,
    });

    const detail = await http()
      .get(`/operator/orgs/${custOrg}`)
      .set('Authorization', bearer(opToken))
      .expect(200);
    expect(detail.body.members).toHaveLength(1);
  });

  it('failures are visible with recipient addresses masked', async () => {
    const f = await http()
      .get('/operator/failures')
      .set('Authorization', bearer(opToken))
      .expect(200);
    const mine = f.body.find((x: { org_id: string }) => x.org_id === custOrg);
    expect(mine).toMatchObject({ kind: 'send', detail: 'j***@customer.local' });
    expect(mine.error).toMatch(/550/);
    expect(JSON.stringify(f.body)).not.toContain('jane.doe');
  });

  it('can switch a workspace plan, and reports system health', async () => {
    await http()
      .patch(`/operator/orgs/${custOrg}/plan`)
      .set('Authorization', bearer(opToken))
      .send({ plan: 'internal' })
      .expect(200);
    const usage = await http()
      .get('/usage')
      .set('Authorization', bearer(custToken));
    expect(usage.body.plan).toBe('internal');
    await http()
      .patch(`/operator/orgs/${custOrg}/plan`)
      .set('Authorization', bearer(opToken))
      .send({ plan: 'enterprise' })
      .expect(400);

    const h = await http()
      .get('/operator/health')
      .set('Authorization', bearer(opToken))
      .expect(200);
    expect(h.body.readiness.checks).toEqual({ db: true, redis: true });
    expect(h.body.queues.send).toBeDefined();
  });

  it('revoking takes effect immediately', async () => {
    await pool.query(`UPDATE users SET is_operator = false WHERE id = $1`, [
      users[0],
    ]);
    await http()
      .get('/operator/overview')
      .set('Authorization', bearer(opToken))
      .expect(403);
  });
});
