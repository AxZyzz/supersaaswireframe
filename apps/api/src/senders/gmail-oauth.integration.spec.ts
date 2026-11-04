/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument */
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'crypto';
import { Pool } from 'pg';
import request from 'supertest';
import { AppModule } from '../app.module';
import { PG_POOL } from '../db/db.module';
import { withOrgContext } from '../db/tenant-context';
import { GMAIL_SEND_SCOPE, GmailOAuthService } from './gmail-oauth.service';

interface SenderJson {
  id: string;
  from_email: string;
}

/** Connect Gmail (T3.3): consent URL → Google callback → verified sender. */
describe('Gmail OAuth integration', () => {
  let app: INestApplication;
  let pool: Pool;
  let oauth: GmailOAuthService;
  let token: string;
  let orgId: string;
  let userId: string;
  const saved = {
    id: process.env.GOOGLE_CLIENT_ID,
    secret: process.env.GOOGLE_CLIENT_SECRET,
  };

  const http = () => request(app.getHttpServer());
  const jwt = () => ({ Authorization: `Bearer ${token}` });

  const idToken = (email: string, verified = true) =>
    [
      Buffer.from('{"alg":"RS256"}').toString('base64url'),
      Buffer.from(JSON.stringify({ email, email_verified: verified })).toString(
        'base64url',
      ),
      'sig',
    ].join('.');

  /** Stub Google's token endpoint with one scripted response. */
  const googleReturns = (status: number, body: unknown) => {
    const calls: URLSearchParams[] = [];
    oauth.fetchFn = (_url: string, init: RequestInit) => {
      calls.push(new URLSearchParams(init.body as string));
      return Promise.resolve(new Response(JSON.stringify(body), { status }));
    };
    return calls;
  };

  const okTokens = (email: string) => ({
    access_token: 'at',
    refresh_token: `rt-${randomUUID()}`,
    id_token: idToken(email),
    scope: `openid ${GMAIL_SEND_SCOPE} https://www.googleapis.com/auth/userinfo.email`,
  });

  /** Mint a consent URL and pull out its signed state. */
  // The browser-binding cookie from the latest connect (OAuth CSRF guard);
  // callback() sends it like the same browser would.
  let browserCookie = '';
  const startConnect = async (fromName?: string) => {
    const res = await http()
      .post('/senders/gmail/connect')
      .set(jwt())
      .send(fromName ? { fromName } : {})
      .expect(200);
    const set = ([] as string[]).concat(res.headers['set-cookie'] ?? []);
    browserCookie = (set.find((c) => c.startsWith('ss_goauth=')) ?? '').split(
      ';',
    )[0];
    return new URL(res.body.url as string);
  };

  const callback = (q: Record<string, string>, cookie = browserCookie) =>
    http()
      .get('/auth/google/callback')
      .set('Cookie', cookie)
      .query(q)
      .expect(302);

  const resultOf = (location: string) =>
    Object.fromEntries(new URL(location).searchParams);

  beforeAll(async () => {
    process.env.GOOGLE_CLIENT_ID ||= 'test-client.apps.googleusercontent.com';
    process.env.GOOGLE_CLIENT_SECRET ||= 'test-secret';
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
    oauth = app.get(GmailOAuthService);
    const res = await http()
      .post('/auth/signup')
      .send({
        email: `gm-${randomUUID().slice(0, 8)}@test.local`,
        password: 'gm-pass-123',
        name: 'G',
        orgName: 'Gmail Org',
      })
      .expect(201);
    token = res.body.accessToken;
    orgId = res.body.org.id;
    userId = res.body.user.id;
  });

  afterAll(async () => {
    await withOrgContext(pool, orgId, (c) =>
      c.query(`DELETE FROM orgs WHERE id = $1`, [orgId]),
    );
    await pool.query(`DELETE FROM users WHERE id = $1`, [userId]);
    await app.close();
    process.env.GOOGLE_CLIENT_ID = saved.id;
    process.env.GOOGLE_CLIENT_SECRET = saved.secret;
    if (saved.id === undefined) delete process.env.GOOGLE_CLIENT_ID;
    if (saved.secret === undefined) delete process.env.GOOGLE_CLIENT_SECRET;
  });

  it('reports that Gmail is enabled on this server', async () => {
    const r = await http().get('/senders/gmail/status').set(jwt()).expect(200);
    expect(r.body).toEqual({ enabled: true });
  });

  it('builds a Google consent URL asking for offline gmail.send', async () => {
    const url = await startConnect();
    expect(url.origin + url.pathname).toBe(
      'https://accounts.google.com/o/oauth2/v2/auth',
    );
    const p = url.searchParams;
    expect(p.get('client_id')).toBeTruthy();
    expect(p.get('redirect_uri')).toMatch(/\/auth\/google\/callback$/);
    expect(p.get('scope')!.split(' ')).toEqual(
      expect.arrayContaining(['openid', 'email', GMAIL_SEND_SCOPE]),
    );
    expect(p.get('access_type')).toBe('offline');
    expect(p.get('prompt')).toBe('consent');
    expect(p.get('state')).toBeTruthy();
  });

  it('callback creates a verified Gmail sender with an encrypted token', async () => {
    const state = (await startConnect('Aman at A2B')).searchParams.get(
      'state',
    )!;
    const tokens = okTokens('Aman.Sales@Gmail.com');
    const calls = googleReturns(200, tokens);

    const res = await callback({ code: 'auth-code-1', state });
    expect(res.headers.location).toMatch(/\/settings\?/);
    expect(resultOf(res.headers.location)).toEqual({
      gmail: 'connected',
      email: 'aman.sales@gmail.com',
    });
    expect(calls[0].get('grant_type')).toBe('authorization_code');
    expect(calls[0].get('code')).toBe('auth-code-1');

    const list = await http().get('/senders').set(jwt()).expect(200);
    const s = (list.body as SenderJson[]).find(
      (x) => x.from_email === 'aman.sales@gmail.com',
    )!;
    expect(s).toMatchObject({
      provider: 'gmail',
      from_name: 'Aman at A2B',
      status: 'verified',
      warmup_enabled: true,
    });
    expect(JSON.stringify(list.body)).not.toContain(tokens.refresh_token);

    const raw = await withOrgContext(pool, orgId, (c) =>
      c.query<{ config: any }>(
        `SELECT config FROM sender_accounts WHERE id = $1`,
        [s.id],
      ),
    );
    const stored = raw.rows[0].config.gmail;
    expect(stored.refreshTokenEnc).toBeTruthy();
    expect(JSON.stringify(raw.rows[0].config)).not.toContain(
      tokens.refresh_token,
    );
  });

  it('reconnecting the same address updates it instead of duplicating', async () => {
    const state = (await startConnect()).searchParams.get('state')!;
    googleReturns(200, okTokens('aman.sales@gmail.com'));
    const res = await callback({ code: 'auth-code-2', state });
    expect(resultOf(res.headers.location).gmail).toBe('reconnected');
    const list = await http().get('/senders').set(jwt()).expect(200);
    expect(
      (list.body as SenderJson[]).filter(
        (x) => x.from_email === 'aman.sales@gmail.com',
      ),
    ).toHaveLength(1);
  });

  it('refuses to turn an existing SMTP sender into Gmail', async () => {
    await http()
      .post('/senders')
      .set(jwt())
      .send({
        provider: 'smtp',
        fromName: 'Ops',
        fromEmail: 'ops@gmail.com',
        smtp: { host: 'h', port: 587, secure: false, user: 'u', pass: 'p' },
      })
      .expect(201);
    const state = (await startConnect()).searchParams.get('state')!;
    googleReturns(200, okTokens('ops@gmail.com'));
    const r = resultOf((await callback({ code: 'c', state })).headers.location);
    expect(r.gmail).toBe('error');
    expect(r.reason).toMatch(/already set up as a SMTP sender/);
  });

  it('explains when the user unticks the send-email permission', async () => {
    const state = (await startConnect()).searchParams.get('state')!;
    googleReturns(200, { ...okTokens('x@gmail.com'), scope: 'openid email' });
    const r = resultOf((await callback({ code: 'c', state })).headers.location);
    expect(r).toMatchObject({ gmail: 'error' });
    expect(r.reason).toMatch(/Permission to send email was not granted/);
  });

  it('handles cancel, tampered state and Google rejecting the code', async () => {
    const cancelled = await callback({ error: 'access_denied', state: 'x' });
    expect(resultOf(cancelled.headers.location).reason).toMatch(/cancelled/);

    const forged = await app
      .get(JwtService)
      .signAsync(
        { type: 'gmail-connect', sub: userId, orgId },
        { secret: 'not-the-server-secret' },
      );
    const tampered = await callback({ code: 'c', state: forged });
    expect(resultOf(tampered.headers.location).reason).toMatch(/expired/);

    const state = (await startConnect()).searchParams.get('state')!;
    googleReturns(400, {
      error: 'invalid_grant',
      error_description: 'Bad Request',
    });
    const rejected = await callback({ code: 'stale', state });
    expect(resultOf(rejected.headers.location).reason).toMatch(
      /Google rejected the sign-in/,
    );
  });

  it('only completes in the browser that started it (OAuth CSRF)', async () => {
    // attacker starts a connect for their workspace, then sends the Google
    // link to a victim, whose browser doesn't have the attacker's cookie
    const state = (await startConnect()).searchParams.get('state')!;
    expect(browserCookie).toMatch(/^ss_goauth=.{20,}/);
    googleReturns(200, okTokens('victim@gmail.com'));
    const victim = await callback({ code: 'c', state }, '');
    expect(resultOf(victim.headers.location)).toMatchObject({ gmail: 'error' });
    expect(resultOf(victim.headers.location).reason).toMatch(/same browser/);
    // a different browser's cookie doesn't work either
    const other = await callback(
      { code: 'c', state },
      'ss_goauth=someone-elses-cookie',
    );
    expect(resultOf(other.headers.location).reason).toMatch(/same browser/);
    const list = await http().get('/senders').set(jwt()).expect(200);
    expect(JSON.stringify(list.body)).not.toContain('victim@gmail.com');
    // the cookie is single-use: the callback clears it
    const ok = await callback({ code: 'c', state });
    expect(
      ([] as string[]).concat(ok.headers['set-cookie'] ?? []).join(';'),
    ).toMatch(/ss_goauth=;/);
  });

  it('an access token is not accepted as a connect state', async () => {
    const r = await callback({ code: 'c', state: token });
    expect(resultOf(r.headers.location).reason).toMatch(/expired/);
  });
});
