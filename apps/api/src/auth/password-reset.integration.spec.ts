/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument */
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'crypto';
import { Pool } from 'pg';
import request from 'supertest';
import { AppModule } from '../app.module';
import { PG_POOL } from '../db/db.module';
import { withOrgContext } from '../db/tenant-context';
import { SystemMailService } from '../mail/system-mail.service';

/** Forgot / reset password (T1.3), mail captured from the system outbox. */
describe('Password reset integration', () => {
  let app: INestApplication;
  let pool: Pool;
  let mail: SystemMailService;
  let orgId: string;
  let userId: string;
  const email = `pr-${randomUUID().slice(0, 8)}@test.local`;
  const http = () => request(app.getHttpServer());

  const lastResetToken = () => {
    const m = [...mail.outbox].reverse().find((x) => x.to === email);
    return m?.action
      ? new URL(m.action.url).searchParams.get('token')
      : undefined;
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
    mail = app.get(SystemMailService);
    const res = await http()
      .post('/auth/signup')
      .send({
        email,
        password: 'old-pass-123',
        name: 'Reset Me',
        orgName: 'Reset Org',
      })
      .expect(201);
    orgId = res.body.org.id;
    userId = res.body.user.id;
  });

  afterAll(async () => {
    await withOrgContext(pool, orgId, (c) =>
      c.query(`DELETE FROM orgs WHERE id = $1`, [orgId]),
    );
    await pool.query(`DELETE FROM users WHERE id = $1`, [userId]);
    await app.close();
  });

  it('answers the same for unknown emails and sends nothing', async () => {
    const before = mail.outbox.length;
    const r = await http()
      .post('/auth/forgot-password')
      .send({ email: `nobody-${randomUUID()}@test.local` })
      .expect(200);
    expect(r.body).toEqual({ ok: true });
    expect(mail.outbox.length).toBe(before);
  });

  it('emails a single-use link that sets a new password and ends old sessions', async () => {
    await http()
      .post('/auth/forgot-password')
      .send({ email: email.toUpperCase() })
      .expect(200);
    const first = lastResetToken();
    expect(first).toBeTruthy();
    const sent = mail.outbox[mail.outbox.length - 1];
    expect(sent.subject).toMatch(/Reset your SuperSaaS password/);
    expect(sent.action!.url).toMatch(/\/reset-password\?token=/);

    // only the newest link works
    await http().post('/auth/forgot-password').send({ email }).expect(200);
    const second = lastResetToken();
    expect(second).not.toBe(first);
    await http()
      .post('/auth/reset-password')
      .send({ token: first, password: 'new-pass-456' })
      .expect(400);

    // the token is stored hashed, never in the clear
    const stored = await pool.query(
      `SELECT token_hash FROM password_resets WHERE user_id = $1`,
      [userId],
    );
    expect(JSON.stringify(stored.rows)).not.toContain(second);

    await http()
      .post('/auth/reset-password')
      .send({ token: second, password: 'short' })
      .expect(400);
    await http()
      .post('/auth/reset-password')
      .send({ token: second, password: 'new-pass-456' })
      .expect(200);

    await http()
      .post('/auth/login')
      .send({ email, password: 'old-pass-123' })
      .expect(401);
    await http()
      .post('/auth/login')
      .send({ email, password: 'new-pass-456' })
      .expect(200);

    // every session that existed before the reset was revoked
    const live = await pool.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM refresh_tokens
       WHERE user_id = $1 AND revoked_at IS NULL AND created_at < (
         SELECT max(used_at) FROM password_resets WHERE user_id = $1)`,
      [userId],
    );
    expect(live.rows[0].n).toBe(0);

    // a used link can't be replayed
    await http()
      .post('/auth/reset-password')
      .send({ token: second, password: 'another-pass-789' })
      .expect(400);
  });

  it('rejects an expired link', async () => {
    await http().post('/auth/forgot-password').send({ email }).expect(200);
    const token = lastResetToken();
    await pool.query(
      `UPDATE password_resets SET expires_at = now() - interval '1 minute'
       WHERE user_id = $1 AND used_at IS NULL`,
      [userId],
    );
    const r = await http()
      .post('/auth/reset-password')
      .send({ token, password: 'new-pass-999' })
      .expect(400);
    expect(r.body.message).toMatch(/invalid or has expired/);
  });
});
