/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-return */
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'crypto';
import { Pool } from 'pg';
import request from 'supertest';
import { AppModule } from '../app.module';
import { CryptoService } from '../crypto/crypto.service';
import { PG_POOL } from '../db/db.module';
import { withOrgContext } from '../db/tenant-context';
import { clearGmailTokenCache } from '../senders/providers/gmail.provider';
import { GmailReplySyncService } from './gmail-reply-sync.service';

const READ = 'https://www.googleapis.com/auth/gmail.readonly';
const SEND = 'https://www.googleapis.com/auth/gmail.send';
const b64 = (s: string) => Buffer.from(s).toString('base64url');

/** A Gmail API "format=full" message. */
const gmailMsg = (
  id: string,
  headers: Record<string, string>,
  text: string,
) => ({
  id,
  payload: {
    mimeType: 'multipart/alternative',
    headers: Object.entries(headers).map(([name, value]) => ({ name, value })),
    parts: [{ mimeType: 'text/plain', body: { data: b64(text) } }],
  },
});

/** Gmail reply reading (T5.7): replies → inbox, bounces → suppression, rest ignored. */
describe('Gmail reply sync integration', () => {
  let app: INestApplication;
  let pool: Pool;
  let sync: GmailReplySyncService;
  let token: string;
  let orgId: string;
  let userId: string;
  let senderId: string;
  const http = () => request(app.getHttpServer());
  const auth = () => ({ Authorization: `Bearer ${token}` });

  // Scripted Gmail: token endpoint, a message list, and full messages.
  let inbox: ReturnType<typeof gmailMsg>[] = [];
  let tokenStatus = 200;
  const calls: string[] = [];
  const google = (input: string | URL | Request) => {
    const url =
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.href
          : input.url;
    calls.push(url);
    const json = (status: number, body: unknown) =>
      Promise.resolve(
        new Response(JSON.stringify(body), {
          status,
          headers: { 'content-type': 'application/json' },
        }),
      );
    if (url.startsWith('https://oauth2.googleapis.com/token')) {
      return tokenStatus === 200
        ? json(200, { access_token: 'gmail-access', expires_in: 3600 })
        : json(400, { error: 'invalid_grant' });
    }
    if (url.includes('/messages?')) {
      return json(200, { messages: inbox.map((m) => ({ id: m.id })) });
    }
    const id = /\/messages\/([^?]+)/.exec(url)?.[1];
    const msg = inbox.find((m) => m.id === id);
    return msg ? json(200, msg) : json(404, { error: { message: 'gone' } });
  };

  const q = async (sql: string, params: unknown[] = []) =>
    withOrgContext(pool, orgId, async (c) => (await c.query(sql, params)).rows);

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
    sync = app.get(GmailReplySyncService);
    sync.fetchFn = google;

    const res = await http()
      .post('/auth/signup')
      .send({
        email: `grs-${randomUUID().slice(0, 8)}@test.local`,
        password: 'grs-pass-123',
        name: 'GRS',
        orgName: 'GRS Org',
      })
      .expect(201);
    token = res.body.accessToken;
    orgId = res.body.org.id;
    userId = res.body.user.id;

    // A connected Gmail sender that granted read access, as the OAuth
    // callback would store it.
    const crypto = app.get(CryptoService);
    const rows = await q(
      `INSERT INTO sender_accounts (org_id, provider, from_name, from_email, config, status)
       VALUES ($1, 'gmail', 'Rep', 'rep@grs.test', $2::jsonb, 'verified') RETURNING id`,
      [
        orgId,
        JSON.stringify({
          gmail: {
            refreshTokenEnc: crypto.encrypt('refresh-token'),
            scope: `openid email ${SEND} ${READ}`,
            connectedAt: new Date().toISOString(),
          },
        }),
      ],
    );
    senderId = rows[0].id;

    // Two leads we've emailed, plus the campaign email Pat will answer.
    for (const [email, first] of [
      ['pat@prospect.test', 'Pat'],
      ['gone@prospect.test', 'Gone'],
    ]) {
      const lead = await http()
        .post('/leads')
        .set(auth())
        .send({ email, firstName: first })
        .expect(201);
      await q(
        `INSERT INTO sent_emails (org_id, lead_id, sender_id, to_email, subject, status, message_id)
         VALUES ($1, $2, $3, $4, 'Quick idea', 'sent', $5)`,
        [orgId, lead.body.id, senderId, email, `<${first}-1@grs.test>`],
      );
    }
  });

  afterAll(async () => {
    await withOrgContext(pool, orgId, (c) =>
      c.query(`DELETE FROM orgs WHERE id = $1`, [orgId]),
    );
    await pool.query(`DELETE FROM users WHERE id = $1`, [userId]);
    await app.close();
  });

  beforeEach(() => {
    clearGmailTokenCache();
    tokenStatus = 200;
    calls.length = 0;
  });

  it('pulls a reply into the inbox, ignores personal mail, handles a bounce', async () => {
    inbox = [
      gmailMsg(
        'm-reply',
        {
          From: 'Pat Lee <pat@prospect.test>',
          Subject: 'Re: Quick idea',
          'Message-ID': '<reply-1@prospect.test>',
          'In-Reply-To': '<Pat-1@grs.test>',
        },
        'Sounds good, can we talk Thursday?\n\nOn Tue, 3 Nov 2026 at 10:00, Rep <rep@grs.test> wrote:\n> Quick idea for you',
      ),
      gmailMsg(
        'm-personal',
        { From: 'Mom <mom@family.test>', Subject: 'Dinner?' },
        'Coming home for dinner?',
      ),
      gmailMsg(
        'm-bounce',
        {
          From: 'Mail Delivery Subsystem <mailer-daemon@googlemail.com>',
          Subject: 'Delivery Status Notification (Failure)',
          'X-Failed-Recipients': 'gone@prospect.test',
        },
        "Address not found. Your message wasn't delivered to gone@prospect.test.",
      ),
    ];

    const r = await sync.syncSender(orgId, senderId);
    expect(r).toMatchObject({
      replies: 1,
      bounces: 1,
      ignored: 1,
      error: null,
    });

    // the reply landed in the inbox, without the quoted original
    const msgs = await q(
      `SELECT m.from_email, m.body_text, m.classification
       FROM conversation_messages m WHERE m.direction = 'inbound'`,
    );
    expect(msgs).toHaveLength(1);
    expect(msgs[0].from_email).toBe('pat@prospect.test');
    expect(msgs[0].body_text).toBe('Sounds good, can we talk Thursday?');
    expect(msgs[0].classification).toBeTruthy();

    // personal mail left no trace beyond its Gmail id
    expect(
      JSON.stringify(await q(`SELECT * FROM conversation_messages`)),
    ).not.toContain('dinner');
    expect(
      await q(`SELECT kind FROM gmail_seen_messages ORDER BY kind`),
    ).toEqual([{ kind: 'bounce' }, { kind: 'ignored' }, { kind: 'reply' }]);

    // the bounce suppressed the address and was recorded
    expect(await q(`SELECT email, reason FROM suppression_list`)).toEqual([
      { email: 'gone@prospect.test', reason: 'bounced' },
    ]);
    expect(
      await q(`SELECT type FROM email_events WHERE type = 'bounce'`),
    ).toHaveLength(1);

    // the sender shows a successful sync
    const list = (await http().get('/senders').set(auth()).expect(200))
      .body as { id: string; reply_sync_at: string | null }[];
    const s = list.find((x) => x.id === senderId);
    expect(s).toMatchObject({
      reply_sync_enabled: true,
      reply_sync_error: null,
    });
    expect(s?.reply_sync_at).toBeTruthy();
  });

  it('never processes the same Gmail message twice', async () => {
    const r = await sync.syncSender(orgId, senderId);
    expect(r).toMatchObject({ replies: 0, bounces: 0, ignored: 0 });
    // listed again, but no message was fetched
    expect(calls.filter((u) => /\/messages\/m-/.test(u))).toHaveLength(0);
    expect(
      await q(
        `SELECT 1 FROM conversation_messages WHERE direction = 'inbound'`,
      ),
    ).toHaveLength(1);
  });

  it('"Sync now" endpoint runs the workspace sync', async () => {
    inbox = [];
    const res = await http().post('/inbox/gmail-sync').set(auth()).expect(200);
    expect(res.body).toEqual({
      senders: 1,
      replies: 0,
      bounces: 0,
      errors: [],
    });
  });

  it('revoked Google access marks the sender for reconnect and records the error', async () => {
    tokenStatus = 400;
    const r = await sync.syncSender(orgId, senderId);
    expect(r.error).toMatch(/revoked|expired/i);
    const [s] = await q(
      `SELECT status, reply_sync_error FROM sender_accounts WHERE id = $1`,
      [senderId],
    );
    expect(s.status).toBe('unverified');
    expect(s.reply_sync_error).toMatch(/revoked|expired/i);
  });
});
