/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument */
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'crypto';
import { Pool } from 'pg';
import request from 'supertest';
import { AppModule } from '../app.module';
import { PG_POOL } from '../db/db.module';
import { withOrgContext } from '../db/tenant-context';
import { SystemMailService } from '../mail/system-mail.service';
import { renderHtml } from '../mail/system-mail.service';

/** Email confirmation at sign-up, with verification switched on. */
describe('Email verification integration', () => {
  let app: INestApplication;
  let pool: Pool;
  let mail: SystemMailService;
  const email = `ev-${randomUUID().slice(0, 8)}@test.local`;
  const password = 'confirm-pass-123';
  const http = () => request(app.getHttpServer());
  const before = process.env.EMAIL_VERIFICATION;

  const lastToken = () => {
    const m = [...mail.outbox].reverse().find((x) => x.to === email);
    return m?.action
      ? (new URL(m.action.url).searchParams.get('token') ?? undefined)
      : undefined;
  };

  beforeAll(async () => {
    process.env.EMAIL_VERIFICATION = 'on';
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
    mail = app.get(SystemMailService);
  });

  afterAll(async () => {
    const u = await pool.query<{ id: string }>(
      `SELECT id FROM users WHERE email = $1`,
      [email],
    );
    if (u.rows[0]) {
      const orgs = await pool.query<{ org_id: string }>(
        `SELECT org_id FROM user_memberships($1)`,
        [u.rows[0].id],
      );
      for (const { org_id } of orgs.rows) {
        await withOrgContext(pool, org_id, (c) =>
          c.query(`DELETE FROM orgs WHERE id = $1`, [org_id]),
        );
      }
      await pool.query(`DELETE FROM users WHERE id = $1`, [u.rows[0].id]);
    }
    process.env.EMAIL_VERIFICATION = before;
    await app.close();
  });

  it('sign-up creates the account but no session, and emails a link', async () => {
    const res = await http()
      .post('/auth/signup')
      .send({ email, password, name: 'Eve', orgName: 'Verify Org' })
      .expect(201);
    expect(res.body).toEqual({ verificationRequired: true, email });
    expect(res.headers['set-cookie']).toBeUndefined();
    const m = [...mail.outbox].reverse().find((x) => x.to === email);
    expect(m?.subject).toMatch(/confirm your email/i);
    expect(m?.action?.url).toMatch(/\/verify-email\?token=/);
    expect(renderHtml(m!)).toContain('Confirm email');
  });

  it('login is refused until confirmed (only with the right password)', async () => {
    await http()
      .post('/auth/login')
      .send({ email, password: 'wrong-password' })
      .expect(401);
    const r = await http()
      .post('/auth/login')
      .send({ email, password })
      .expect(403);
    expect(r.body.code).toBe('EMAIL_NOT_VERIFIED');
  });

  it('resend answers the same for any email and retires the old link', async () => {
    const first = lastToken();
    const unknown = await http()
      .post('/auth/resend-verification')
      .send({ email: `nobody-${randomUUID()}@test.local` })
      .expect(200);
    expect(unknown.body).toEqual({ ok: true });
    await http().post('/auth/resend-verification').send({ email }).expect(200);
    const second = lastToken();
    expect(second).toBeDefined();
    expect(second).not.toBe(first);
    await http().post('/auth/verify-email').send({ token: first }).expect(400);
  });

  it('the link confirms, signs in, works once; then normal login works', async () => {
    const token = lastToken();
    const ok = await http()
      .post('/auth/verify-email')
      .send({ token })
      .expect(200);
    expect(ok.body.accessToken).toBeTruthy();
    expect(ok.body.refreshToken).toBeUndefined(); // moved into the cookie
    expect(String(ok.headers['set-cookie'])).toMatch(/ss_rt=/);
    expect(ok.body.user.email).toBe(email);

    await http().post('/auth/verify-email').send({ token }).expect(400);
    const login = await http()
      .post('/auth/login')
      .send({ email, password })
      .expect(200);
    expect(login.body.accessToken).toBeTruthy();
  });

  it('existing users were marked confirmed by the migration', async () => {
    const r = await pool.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM users
       WHERE email_verified_at IS NULL AND created_at < now() - interval '1 hour'`,
    );
    expect(r.rows[0].n).toBe(0);
  });
});
