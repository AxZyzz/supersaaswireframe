/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-call */
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'crypto';
import { Pool } from 'pg';
import request from 'supertest';
import { AppModule } from '../app.module';
import { PG_POOL } from '../db/db.module';
import { withOrgContext } from '../db/tenant-context';

/** T10.7: invite-only sign-up via the waitlist, plus in-app feedback. */
describe('Beta: waitlist + feedback', () => {
  let app: INestApplication;
  let pool: Pool;
  const http = () => request(app.getHttpServer());
  const users: string[] = [];
  const orgs: string[] = [];
  const emails: string[] = [];
  let opToken: string;
  const prevMode = process.env.SIGNUP_MODE;
  const uniq = (p: string) => {
    const e = `${p}-${randomUUID().slice(0, 8)}@test.local`;
    emails.push(e);
    return e;
  };
  const signup = (email: string, inviteCode?: string) =>
    http().post('/auth/signup').send({
      email,
      password: 'beta-pass-123',
      name: 'B',
      orgName: 'Beta Co',
      inviteCode,
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

    process.env.SIGNUP_MODE = 'open';
    const op = await signup(uniq('op')).expect(201);
    opToken = op.body.accessToken;
    users.push(op.body.user.id);
    orgs.push(op.body.org.id);
    await pool.query(`UPDATE users SET is_operator = true WHERE id = $1`, [
      op.body.user.id,
    ]);
  });

  afterAll(async () => {
    process.env.SIGNUP_MODE = prevMode;
    for (const id of orgs) {
      await withOrgContext(pool, id, (c) =>
        c.query(`DELETE FROM orgs WHERE id = $1`, [id]),
      );
    }
    for (const id of users)
      await pool.query(`DELETE FROM users WHERE id = $1`, [id]);
    await pool.query(`DELETE FROM waitlist WHERE email = ANY($1)`, [emails]);
    await app.close();
  });

  it('waitlist mode: sign-up needs an approved invite for that exact email', async () => {
    process.env.SIGNUP_MODE = 'waitlist';
    expect((await http().get('/beta/mode')).body).toEqual({ mode: 'waitlist' });

    const email = uniq('wl');
    const refused = await signup(email).expect(403);
    expect(refused.body.message).toMatch(/invite-only/);

    // joining is idempotent and doesn't reveal whether the email exists
    const a = await http()
      .post('/waitlist')
      .send({ email, name: 'Wanda', company: 'Acme' })
      .expect(200);
    const b = await http().post('/waitlist').send({ email }).expect(200);
    expect(a.body).toEqual(b.body);

    const list = await http()
      .get('/operator/waitlist')
      .set('Authorization', `Bearer ${opToken}`)
      .expect(200);
    const entry = list.body.find((w: { email: string }) => w.email === email);
    expect(entry).toMatchObject({ status: 'pending', name: 'Wanda' });

    const appr = await http()
      .post(`/operator/waitlist/${entry.id}/approve`)
      .set('Authorization', `Bearer ${opToken}`)
      .expect(200);
    const code = appr.body.code as string;

    await signup(uniq('other'), code).expect(403); // code is bound to the email
    const ok = await signup(email, code).expect(201);
    users.push(ok.body.user.id);
    orgs.push(ok.body.org.id);
    await signup(uniq('again'), code).expect(403); // single use

    const after = await http()
      .get('/operator/waitlist')
      .set('Authorization', `Bearer ${opToken}`);
    expect(
      after.body.find((w: { email: string }) => w.email === email).status,
    ).toBe('joined');
  });

  it('open mode: anyone can sign up', async () => {
    process.env.SIGNUP_MODE = 'open';
    const r = await signup(uniq('open')).expect(201);
    users.push(r.body.user.id);
    orgs.push(r.body.org.id);
  });

  it('members send feedback; operators read it across workspaces', async () => {
    await http()
      .post('/feedback')
      .set('Authorization', `Bearer ${opToken}`)
      .send({
        kind: 'idea',
        message: 'Bulk-edit for leads please',
        page: '/leads',
      })
      .expect(201);
    await http()
      .post('/feedback')
      .set('Authorization', `Bearer ${opToken}`)
      .send({ kind: 'rant', message: 'x' })
      .expect(400);
    const f = await http()
      .get('/operator/feedback')
      .set('Authorization', `Bearer ${opToken}`)
      .expect(200);
    expect(f.body[0]).toMatchObject({
      kind: 'idea',
      message: 'Bulk-edit for leads please',
      page: '/leads',
    });
    expect(f.body[0].org_name).toBe('Beta Co');
  });

  it('waitlist admin is operator-only', async () => {
    process.env.SIGNUP_MODE = 'open';
    const r = await signup(uniq('cust')).expect(201);
    users.push(r.body.user.id);
    orgs.push(r.body.org.id);
    await http()
      .get('/operator/waitlist')
      .set('Authorization', `Bearer ${r.body.accessToken}`)
      .expect(403);
    await http()
      .get('/operator/feedback')
      .set('Authorization', `Bearer ${r.body.accessToken}`)
      .expect(403);
  });
});
