/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-return */
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'crypto';
import { Pool } from 'pg';
import request from 'supertest';
import { AppModule } from '../app.module';
import { PG_POOL } from '../db/db.module';
import { withOrgContext } from '../db/tenant-context';
import { clearGmailTokenCache } from '../senders/providers/gmail.provider';
import { CALENDAR_SCOPE } from './calendar-logic';
import { CalendarOAuthService } from './calendar-oauth.service';
import { CalendarSyncService } from './calendar-sync.service';
import { IntegrationsService } from './integrations.service';

const DAY = 86_400_000;
const ago = (days: number) => new Date(Date.now() - days * DAY);
const ahead = (days: number) => new Date(Date.now() + days * DAY);

interface FakeEvent {
  id: string;
  status: string;
  created: string;
  updated: string;
  start?: { dateTime: string };
  attendees?: { email: string; self?: boolean; responseStatus?: string }[];
}

/** Google Calendar booked calls (T16) against a fake Google. */
describe('Google Calendar booked calls (T16)', () => {
  let app: INestApplication;
  let pool: Pool;
  let sync: CalendarSyncService;
  let integrations: IntegrationsService;
  let token: string;
  let agentToken: string;
  let orgId: string;
  let userId: string;
  let otherOrgId: string;
  let otherUserId: string;
  let agentId: string;
  let campaignId: string;
  let enrollmentId: string;
  const tag = randomUUID().slice(0, 6);
  const email = (name: string) => `${name}@t16-${tag}.com`;
  const http = () => request(app.getHttpServer());
  const auth = () => ({ Authorization: `Bearer ${token}` });
  const q = <T>(
    fn: (c: Parameters<Parameters<typeof withOrgContext>[2]>[0]) => Promise<T>,
  ) => withOrgContext(pool, orgId, fn);

  // ── the fake Google ─────────────────────────────────────────────────────
  // One event feed that BOTH workspaces read, so a leak between them would show.
  let feed: FakeEvent[] = [];
  let eventsStatus = 200;
  let tokenError: string | null = null;
  const requests: string[] = [];
  let firstSyncUrl = '';
  const json = (status: number, body: unknown) =>
    Promise.resolve(new Response(JSON.stringify(body), { status }));
  const google = (url: string) => {
    const u = String(url);
    if (u.includes('oauth2.googleapis.com/token')) {
      return tokenError
        ? json(400, { error: tokenError })
        : json(200, { access_token: 'at', expires_in: 3600 });
    }
    requests.push(u);
    if (eventsStatus !== 200) {
      return json(eventsStatus, { error: { message: 'calendar says no' } });
    }
    return json(200, { items: feed });
  };
  const ev = (
    id: string,
    attendees: string[],
    o: { created?: Date; start?: Date; status?: string } = {},
  ): FakeEvent => ({
    id,
    status: o.status ?? 'confirmed',
    created: (o.created ?? ago(1)).toISOString(),
    updated: new Date().toISOString(),
    start: { dateTime: (o.start ?? ahead(3)).toISOString() },
    attendees: [
      { email: 'Owner@Gmail.com', self: true },
      ...attendees.map((a) => ({ email: a })),
    ],
  });
  const cancelled = (id: string): FakeEvent => ({
    id,
    status: 'cancelled',
    created: ago(1).toISOString(),
    updated: new Date().toISOString(),
  });

  const idToken = (mail: string) =>
    [
      'h',
      Buffer.from(
        JSON.stringify({ email: mail, email_verified: true }),
      ).toString('base64url'),
      's',
    ].join('.');

  const rows = (org = orgId) =>
    withOrgContext(pool, org, (c) =>
      c.query<{
        type: string;
        source: string;
        verification: string;
        lead_id: string | null;
        campaign_lead_id: string | null;
        company_key: string | null;
        idempotency_key: string;
        supersedes_id: string | null;
        verified_by: string | null;
        verified_at: Date | null;
        occurred_at: Date;
        reason: string | null;
        id: string;
      }>(
        `SELECT id, type, source, verification, lead_id, campaign_lead_id, company_key,
                idempotency_key, supersedes_id, verified_by, verified_at, occurred_at, reason
           FROM outcome_events WHERE idempotency_key LIKE 'cal%' ORDER BY created_at`,
      ),
    ).then((r) => r.rows);

  const mkLead = async (tok: string, mail: string) =>
    (
      await http()
        .post('/leads')
        .set({ Authorization: `Bearer ${tok}` })
        .send({ email: mail, firstName: mail.split('@')[0] })
        .expect(201)
    ).body.id as string;

  const insertSend = (
    org: string,
    leadId: string,
    mail: string,
    sentAt: Date,
    link?: { campaignId: string; campaignLeadId: string },
  ) =>
    withOrgContext(pool, org, (c) =>
      c.query(
        `INSERT INTO sent_emails (org_id, campaign_id, campaign_lead_id, lead_id, to_email, subject, status, sent_at)
         VALUES ($1, $2, $3, $4, $5, 'Hello', 'sent', $6)`,
        [
          org,
          link?.campaignId ?? null,
          link?.campaignLeadId ?? null,
          leadId,
          mail,
          sentAt,
        ],
      ),
    );

  beforeAll(async () => {
    process.env.GOOGLE_CLIENT_ID ||= 'test-client.apps.googleusercontent.com';
    process.env.GOOGLE_CLIENT_SECRET ||= 'test-secret';
    process.env.THROTTLE_DISABLED = 'true';
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
    sync = app.get(CalendarSyncService);
    sync.fetchFn = google;
    integrations = app.get(IntegrationsService);
    clearGmailTokenCache();

    const a = await http()
      .post('/auth/signup')
      .send({
        email: `t16-a-${tag}@test.local`,
        password: 't16-password-123',
        name: 'T16 Admin',
        orgName: 'T16 Org A',
      })
      .expect(201);
    token = a.body.accessToken;
    orgId = a.body.org.id;
    userId = a.body.user.id;
    const b = await http()
      .post('/auth/signup')
      .send({
        email: `t16-b-${tag}@test.local`,
        password: 't16-password-123',
        name: 'T16 Other',
        orgName: 'T16 Org B',
      })
      .expect(201);
    const otherToken = b.body.accessToken;
    otherOrgId = b.body.org.id;
    otherUserId = b.body.user.id;

    const inv = await http()
      .post('/orgs/invites')
      .set(auth())
      .send({ email: `t16-agent-${tag}@test.local`, role: 'agent' })
      .expect(201);
    const reg = await http()
      .post(`/invites/${inv.body.token}/register`)
      .send({ name: 'T16 Agent', password: 'agent-pass-123' })
      .expect(201);
    agentToken = reg.body.accessToken;
    agentId = reg.body.user.id;

    // Workspace A: jane was emailed 3 days ago inside a campaign; "late" was emailed
    // an hour ago (after the bookings below); "old" 30 days ago; "nosend" never.
    const jane = await mkLead(token, email('jane'));
    const seg = await http()
      .post('/segments')
      .set(auth())
      .send({ name: `T16Seg-${tag}`, type: 'manual' })
      .expect(201);
    const camp = await http()
      .post('/campaigns')
      .set(auth())
      .send({ name: 'T16 Calendar', segmentId: seg.body.id })
      .expect(201);
    campaignId = camp.body.id;
    enrollmentId = (
      await q((c) =>
        c.query<{ id: string }>(
          `INSERT INTO campaign_leads (org_id, campaign_id, lead_id, status)
           VALUES ($1, $2, $3, 'active') RETURNING id`,
          [orgId, campaignId, jane],
        ),
      )
    ).rows[0].id;
    await insertSend(orgId, jane, email('jane'), ago(3), {
      campaignId,
      campaignLeadId: enrollmentId,
    });
    const late = await mkLead(token, email('late'));
    await insertSend(orgId, late, email('late'), ago(1 / 24));
    const old = await mkLead(token, email('old'));
    await insertSend(orgId, old, email('old'), ago(30));
    await mkLead(token, email('nosend'));

    // Workspace B has its own lead, emailed 3 days ago.
    const bLead = await mkLead(otherToken, email('only-b'));
    await insertSend(otherOrgId, bLead, email('only-b'), ago(3));
  });

  afterAll(async () => {
    for (const [org, user] of [
      [orgId, userId],
      [otherOrgId, otherUserId],
    ]) {
      await withOrgContext(pool, org, (c) =>
        c.query(`DELETE FROM orgs WHERE id = $1`, [org]),
      );
      await pool.query(`DELETE FROM users WHERE id = $1`, [user]);
    }
    await pool.query(`DELETE FROM users WHERE id = $1`, [agentId]);
    await app.close();
  });

  it('does nothing until a calendar is connected', async () => {
    const o = await http().get('/integrations').set(auth()).expect(200);
    expect(o.body.googleCalendar).toMatchObject({
      available: true,
      connected: false,
      needsReconnect: false,
      bookedCalls: 0,
    });
    expect(await sync.syncOrg(orgId)).toEqual({
      events: 0,
      booked: 0,
      cancelled: 0,
    });
    expect(requests).toHaveLength(0);
  });

  it('connects read-only: calendar scope only, same browser only, admins and managers only', async () => {
    await http()
      .post('/integrations/google-calendar/connect')
      .set({ Authorization: `Bearer ${agentToken}` })
      .expect(403);

    const r = await http()
      .post('/integrations/google-calendar/connect')
      .set(auth())
      .expect(200);
    const url = new URL(r.body.url);
    const scopes = url.searchParams.get('scope')!.split(' ');
    expect(scopes).toContain(CALENDAR_SCOPE);
    expect(scopes.some((s) => /gmail|spreadsheets/.test(s))).toBe(false);

    app.get(CalendarOAuthService).fetchFn = () =>
      json(200, {
        access_token: 'at',
        refresh_token: `rt-${randomUUID()}`,
        id_token: idToken('Owner@Gmail.com'),
        scope: `openid email ${CALENDAR_SCOPE}`,
      });
    const cookie = ([] as string[])
      .concat(r.headers['set-cookie'] ?? [])
      .find((c) => c.startsWith('ss_goauth='))!
      .split(';')[0];
    const state = url.searchParams.get('state')!;

    // another browser (no binding cookie): refused, nothing connected
    const elsewhere = await http()
      .get('/auth/google/callback')
      .query({ code: 'c', state })
      .expect(302);
    expect(
      new URL(elsewhere.headers.location).searchParams.get('reason'),
    ).toMatch(/same browser/);
    expect(
      (await http().get('/integrations').set(auth())).body.googleCalendar
        .connected,
    ).toBe(false);

    // the same browser: connected, and the address is stored lower-case
    const ok = await http()
      .get('/auth/google/callback')
      .set('Cookie', cookie)
      .query({ code: 'c', state })
      .expect(302);
    const back = new URL(ok.headers.location);
    expect(back.pathname).toBe('/settings');
    expect(back.searchParams.get('calendar')).toBe('connected');
    expect(back.searchParams.get('email')).toBe('owner@gmail.com');
    const o = await http().get('/integrations').set(auth()).expect(200);
    expect(o.body.googleCalendar).toMatchObject({
      connected: true,
      accountEmail: 'owner@gmail.com',
      needsReconnect: false,
    });
    // the refresh token is stored encrypted
    const stored = await q((c) =>
      c.query<{ config: Record<string, unknown> }>(
        `SELECT config FROM integrations WHERE provider = 'google_calendar'`,
      ),
    );
    expect(stored.rows[0].config).not.toHaveProperty('refreshToken');
    expect(stored.rows[0].config.refreshTokenEnc).toEqual(expect.any(String));
  });

  it('refuses the connection when the calendar permission is not granted', async () => {
    const r = await http()
      .post('/integrations/google-calendar/connect')
      .set(auth())
      .expect(200);
    app.get(CalendarOAuthService).fetchFn = () =>
      json(200, {
        access_token: 'at',
        refresh_token: 'rt-x',
        id_token: idToken('someone@gmail.com'),
        scope: 'openid email',
      });
    const cookie = ([] as string[])
      .concat(r.headers['set-cookie'] ?? [])
      .find((c) => c.startsWith('ss_goauth='))!
      .split(';')[0];
    const res = await http()
      .get('/auth/google/callback')
      .set('Cookie', cookie)
      .query({
        code: 'c',
        state: new URL(r.body.url).searchParams.get('state')!,
      })
      .expect(302);
    expect(new URL(res.headers.location).searchParams.get('calendar')).toBe(
      'error',
    );
    // still connected as before
    expect(
      (await http().get('/integrations').set(auth())).body.googleCalendar
        .accountEmail,
    ).toBe('owner@gmail.com');
  });

  it('a meeting with a lead we emailed becomes a verified booked call, linked to the enrollment', async () => {
    feed = [ev('evt-jane', [`Jane@${email('x').split('@')[1]}`])];
    requests.length = 0;
    const res = await sync.syncOrg(orgId);
    firstSyncUrl = requests[0];
    expect(res).toEqual({ events: 1, booked: 1, cancelled: 0 });

    const out = await rows();
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      type: 'booked_call',
      source: 'calendar',
      verification: 'verified',
      campaign_lead_id: enrollmentId,
      idempotency_key: 'cal:owner@gmail.com:evt-jane',
      supersedes_id: null,
      verified_by: null, // a system fact, not a person
    });
    expect(out[0].verified_at).not.toBeNull();
    expect(out[0].lead_id).not.toBeNull();
    // the outcome happened when the meeting was booked for
    expect(
      Math.abs(out[0].occurred_at.getTime() - ahead(3).getTime()),
    ).toBeLessThan(60_000);

    const o = await http().get('/integrations').set(auth()).expect(200);
    expect(o.body.googleCalendar).toMatchObject({
      lastStatus: 'ok',
      bookedCalls: 1,
    });
    expect(o.body.googleCalendar.lastSyncedAt).toEqual(expect.any(String));
  });

  it('asks Google for ids, times and attendee emails only, and reads incrementally after the first sync', async () => {
    const u = new URL(firstSyncUrl);
    expect(u.pathname).toBe('/calendar/v3/calendars/primary/events');
    expect(u.searchParams.get('showDeleted')).toBe('true');
    expect(u.searchParams.get('singleEvents')).toBe('true');
    // first sync: a time range, no cursor
    expect(u.searchParams.get('timeMin')).toBeTruthy();
    expect(u.searchParams.get('timeMax')).toBeTruthy();
    expect(u.searchParams.get('updatedMin')).toBeNull();
    const fields = u.searchParams.get('fields')!;
    expect(fields).not.toMatch(/summary|description|location|organizer/);

    // next sync: only what changed since the last one, deleted events included
    requests.length = 0;
    await sync.syncOrg(orgId);
    const n = new URL(requests[0]);
    expect(n.searchParams.get('updatedMin')).toBeTruthy();
    expect(n.searchParams.get('timeMin')).toBeNull();
  });

  it('a repeated sync never duplicates the outcome', async () => {
    const again = await sync.syncOrg(orgId);
    expect(again.booked).toBe(0);
    expect(await rows()).toHaveLength(1);
  });

  it('matches attendee addresses whatever their case', async () => {
    // the lead is stored as "jane@..."; a second event spells it in capitals
    feed = [ev('evt-case', [email('jane').toUpperCase()])];
    const res = await sync.syncOrg(orgId);
    expect(res.booked).toBe(1);
    expect((await rows()).map((r) => r.idempotency_key)).toContain(
      'cal:owner@gmail.com:evt-case',
    );
  });

  it('records nothing when nobody we emailed in time is on the invite', async () => {
    feed = [
      ev('evt-unknown', ['stranger@elsewhere.com']), // not a lead
      ev('evt-nosend', [email('nosend')]), // a lead we never emailed
      ev('evt-old', [email('old')]), // emailed 30 days ago: window closed
      ev('evt-late', [email('late')], { created: ago(2) }), // booked before we emailed
      ev('evt-declined', [email('jane')]), // replaced below
      ev('evt-far', [email('jane')], { start: ahead(60) }), // outside the 30 days
    ];
    feed[4].attendees = [
      { email: 'Owner@Gmail.com', self: true },
      { email: email('jane'), responseStatus: 'declined' },
    ];
    const before = (await rows()).length;
    const res = await sync.syncOrg(orgId);
    expect(res.events).toBe(6);
    expect(res.booked).toBe(0);
    expect(await rows()).toHaveLength(before);
  });

  it('never matches a lead from another workspace, and the other workspace books only its own', async () => {
    // workspace B: connect its calendar and let it read the same feed
    await integrations.saveCalendar(otherOrgId, otherUserId, {
      email: 'b-owner@gmail.com',
      refreshToken: `rt-b-${randomUUID()}`,
      scope: CALENDAR_SCOPE,
    });
    feed = [
      ev('evt-b', [email('only-b')]), // B's lead only
      ev('evt-a', [email('jane')], { created: ago(1) }), // A's lead only
    ];
    const a = await sync.syncOrg(orgId);
    const b = await sync.syncOrg(otherOrgId);
    expect(a.booked).toBe(1); // jane's meeting only
    expect(b.booked).toBe(1); // only-b's meeting only

    expect((await rows(otherOrgId)).map((r) => r.idempotency_key)).toEqual([
      'cal:b-owner@gmail.com:evt-b',
    ]);
    const inA = (await rows()).map((r) => r.idempotency_key);
    expect(inA).toContain('cal:owner@gmail.com:evt-a');
    expect(inA.some((k) => k.endsWith(':evt-b'))).toBe(false);
  });

  it('a cancelled event rejects the booked call, once, and an unknown cancellation does nothing', async () => {
    // evt-jane was booked earlier; Google now reports it cancelled with no attendees
    feed = [cancelled('evt-jane'), cancelled('evt-never-seen')];
    const res = await sync.syncOrg(orgId);
    expect(res).toMatchObject({ events: 2, cancelled: 1 });

    const out = await rows();
    const booked = out.find(
      (r) => r.idempotency_key === 'cal:owner@gmail.com:evt-jane',
    )!;
    const reject = out.find(
      (r) => r.idempotency_key === 'calcancel:owner@gmail.com:evt-jane',
    )!;
    expect(reject).toMatchObject({
      type: 'booked_call',
      source: 'calendar',
      verification: 'rejected',
    });
    expect(reject.reason).toMatch(/cancelled/);
    expect(reject.lead_id).toBe(booked.lead_id);
    expect(reject.campaign_lead_id).toBe(booked.campaign_lead_id);
    expect(out.some((r) => r.idempotency_key.includes('evt-never-seen'))).toBe(
      false,
    );

    // the superseding row points at the booking, so the booking is no longer current
    expect(reject.supersedes_id).toBe(booked.id);
    const current = await q((c) =>
      c.query(
        `SELECT 1 FROM v_outcomes_current WHERE idempotency_key = 'cal:owner@gmail.com:evt-jane'`,
      ),
    );
    expect(current.rowCount).toBe(0);

    // a second sync of the same cancellation adds nothing
    const again = await sync.syncOrg(orgId);
    expect(again.cancelled).toBe(0);
    expect(
      (await rows()).filter((r) => r.idempotency_key.startsWith('calcancel:')),
    ).toHaveLength(1);
  });

  it('shows "Reconnect needed" and stops syncing when Google revoked the access', async () => {
    clearGmailTokenCache();
    tokenError = 'invalid_grant';
    const res = await sync.syncOrg(orgId);
    expect(res).toEqual({ events: 0, booked: 0, cancelled: 0 });
    const o = await http().get('/integrations').set(auth()).expect(200);
    expect(o.body.googleCalendar).toMatchObject({
      connected: true,
      lastStatus: 'error',
      needsReconnect: true,
    });
    expect(o.body.googleCalendar.lastError).toMatch(/Reconnect/);
    // the job leaves it alone until it is reconnected
    const due = await pool.query<{ org_id: string }>(
      `SELECT * FROM due_calendar_syncs('0 seconds'::interval)`,
    );
    expect(due.rows.map((d) => d.org_id)).not.toContain(orgId);
    tokenError = null;
    clearGmailTokenCache();
  });

  it('keeps the cursor and says what went wrong when Google Calendar errors', async () => {
    await integrations.saveCalendar(orgId, userId, {
      email: 'owner@gmail.com',
      refreshToken: `rt-${randomUUID()}`,
      scope: CALENDAR_SCOPE,
    });
    feed = [];
    await sync.syncOrg(orgId); // good sync: sets the cursor
    const cursor = async () =>
      (await http().get('/integrations').set(auth())).body.googleCalendar;
    const good = await cursor();
    expect(good).toMatchObject({ lastStatus: 'ok', needsReconnect: false });

    eventsStatus = 403;
    await sync.syncOrg(orgId);
    const bad = await cursor();
    expect(bad).toMatchObject({ lastStatus: 'error', needsReconnect: false });
    expect(bad.lastError).toMatch(/HTTP 403/);
    expect(bad.lastSyncedAt).toBe(good.lastSyncedAt);

    eventsStatus = 401;
    await sync.syncOrg(orgId);
    expect((await cursor()).needsReconnect).toBe(true);
    eventsStatus = 200;
  });

  it('the 15-minute job reads every connected calendar that is due', async () => {
    await integrations.saveCalendar(orgId, userId, {
      email: 'owner@gmail.com',
      refreshToken: `rt-${randomUUID()}`,
      scope: CALENDAR_SCOPE,
    });
    feed = [];
    const before = requests.length;
    const res = await sync.runDue();
    expect(res.ran).toBeGreaterThanOrEqual(1);
    expect(requests.length).toBeGreaterThan(before);
    // just synced: not due again straight away
    const due = await pool.query<{ org_id: string }>(
      `SELECT * FROM due_calendar_syncs('14 minutes'::interval)`,
    );
    expect(due.rows.map((d) => d.org_id)).not.toContain(orgId);
  });

  it('disconnecting forgets the calendar but keeps the outcomes already recorded', async () => {
    const before = (await rows()).length;
    expect(before).toBeGreaterThan(0);
    await http()
      .delete('/integrations/google-calendar')
      .set(auth())
      .expect(200);
    const o = await http().get('/integrations').set(auth()).expect(200);
    expect(o.body.googleCalendar.connected).toBe(false);
    expect(await rows()).toHaveLength(before);
    await http()
      .delete('/integrations/google-calendar')
      .set({ Authorization: `Bearer ${agentToken}` })
      .expect(403);
  });
});
