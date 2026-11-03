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
import { SHEETS_SCOPE, SheetsOAuthService } from './sheets-oauth.service';
import { SheetsService, spreadsheetIdFrom } from './sheets.service';

const SHEET_ID = '1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789abcd';
const SHEET_URL = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/edit#gid=0`;

describe('spreadsheetIdFrom', () => {
  it('takes share links and bare ids, rejects anything else', () => {
    expect(spreadsheetIdFrom(SHEET_URL)).toBe(SHEET_ID);
    expect(spreadsheetIdFrom(`  ${SHEET_ID} `)).toBe(SHEET_ID);
    expect(spreadsheetIdFrom('https://example.com/not-a-sheet')).toBeNull();
    expect(spreadsheetIdFrom('short')).toBeNull();
  });
});

/** Google Sheets sync (T2.8) against a fake Google. */
describe('Google Sheets integration', () => {
  let app: INestApplication;
  let pool: Pool;
  let token: string;
  let orgId: string;
  let userId: string;
  const http = () => request(app.getHttpServer());
  const auth = () => ({ Authorization: `Bearer ${token}` });

  // The fake spreadsheet; tests edit it between syncs.
  let rows: string[][] = [];
  let sheetsStatus = 200;
  const json = (status: number, body: unknown) =>
    Promise.resolve(new Response(JSON.stringify(body), { status }));
  const google = (url: string) => {
    const u = String(url);
    if (u.includes('oauth2.googleapis.com/token')) {
      return json(200, { access_token: 'at', expires_in: 3600 });
    }
    if (sheetsStatus !== 200) {
      return json(sheetsStatus, { error: { message: 'nope' } });
    }
    if (u.includes('/values/')) return json(200, { values: rows });
    return json(200, {
      properties: { title: 'Q4 leads' },
      sheets: [
        { properties: { title: 'Sheet1' } },
        { properties: { title: "Bob's tab" } },
      ],
    });
  };

  const waitForJob = async (id: string) => {
    for (let i = 0; i < 100; i++) {
      const r = await http().get(`/leads/import/${id}`).set(auth()).expect(200);
      if (r.body.status === 'completed' || r.body.status === 'failed')
        return r.body;
      await new Promise((res) => setTimeout(res, 100));
    }
    throw new Error('import did not finish');
  };
  const lead = async (email: string) =>
    (
      await withOrgContext(pool, orgId, (c) =>
        c.query<{ first_name: string; company: string; source: string }>(
          `SELECT first_name, company, source FROM leads WHERE email = $1`,
          [email],
        ),
      )
    ).rows[0];

  const idToken = (email: string) =>
    [
      'h',
      Buffer.from(JSON.stringify({ email, email_verified: true })).toString(
        'base64url',
      ),
      's',
    ].join('.');

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
    app.get(SheetsService).fetchFn = google;
    clearGmailTokenCache();
    const res = await http()
      .post('/auth/signup')
      .send({
        email: `gs-${randomUUID().slice(0, 8)}@test.local`,
        password: 'gs-pass-123',
        name: 'G',
        orgName: 'Sheets Co',
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
  });

  it('needs a connection before previewing', async () => {
    const o = await http().get('/integrations').set(auth()).expect(200);
    expect(o.body.googleSheets).toMatchObject({
      available: true,
      connected: false,
    });
    const r = await http()
      .post('/integrations/google-sheets/preview')
      .set(auth())
      .send({ url: SHEET_URL })
      .expect(400);
    expect(r.body.message).toMatch(/not connected/);
  });

  it('connects read-only via the shared Google callback', async () => {
    const r = await http()
      .post('/integrations/google-sheets/connect')
      .set(auth())
      .send({ returnTo: '/leads' })
      .expect(200);
    const url = new URL(r.body.url);
    expect(url.searchParams.get('scope')!.split(' ')).toContain(SHEETS_SCOPE);
    expect(url.searchParams.get('scope')).not.toMatch(/gmail/);

    app.get(SheetsOAuthService).fetchFn = () =>
      json(200, {
        access_token: 'at',
        refresh_token: `rt-${randomUUID()}`,
        id_token: idToken('Owner@Gmail.com'),
        scope: `openid email ${SHEETS_SCOPE}`,
      });
    const cb = await http()
      .get('/auth/google/callback')
      .query({ code: 'c', state: url.searchParams.get('state')! })
      .expect(302);
    const back = new URL(cb.headers.location);
    expect(back.pathname).toBe('/leads');
    expect(Object.fromEntries(back.searchParams)).toEqual({
      sheets: 'connected',
      email: 'owner@gmail.com',
    });
    const o = await http().get('/integrations').set(auth()).expect(200);
    expect(o.body.googleSheets).toMatchObject({
      connected: true,
      accountEmail: 'owner@gmail.com',
    });
  });

  it('previews a sheet: title, tabs, headers and first rows', async () => {
    rows = [
      ['Email', 'First Name', 'Company'],
      ['ann@acme.test', 'Ann', 'Acme'],
      ['bob@beta.test', 'Bob', 'Beta'],
    ];
    await http()
      .post('/integrations/google-sheets/preview')
      .set(auth())
      .send({ url: 'https://example.com/x' })
      .expect(400);
    const r = await http()
      .post('/integrations/google-sheets/preview')
      .set(auth())
      .send({ url: SHEET_URL })
      .expect(200);
    expect(r.body).toMatchObject({
      spreadsheetId: SHEET_ID,
      title: 'Q4 leads',
      sheets: ['Sheet1', "Bob's tab"],
      sheet: 'Sheet1',
      headers: ['Email', 'First Name', 'Company'],
      totalRows: 2,
    });
    expect(r.body.rows).toHaveLength(2);
  });

  let syncId: string;
  it('imports the tab as google_sheet leads, then re-syncs changes', async () => {
    await http()
      .post('/sheet-syncs')
      .set(auth())
      .send({
        spreadsheetId: SHEET_ID,
        sheetTitle: 'Sheet1',
        mapping: { Company: 'company' },
      })
      .expect(400); // no email column

    const r = await http()
      .post('/sheet-syncs')
      .set(auth())
      .send({
        spreadsheetId: SHEET_ID,
        sheetTitle: 'Sheet1',
        mapping: {
          Email: 'email',
          'First Name': 'firstName',
          Company: 'company',
        },
      })
      .expect(201);
    syncId = r.body.id;
    const job = await waitForJob(r.body.jobId);
    expect(job).toMatchObject({ status: 'completed', imported: 2 });
    expect(await lead('ann@acme.test')).toMatchObject({
      first_name: 'Ann',
      source: 'google_sheet',
    });

    // the sheet changes: Ann moves company, Cara is added
    rows = [...rows, ['cara@corp.test', 'Cara', 'Corp']];
    rows[1] = ['ann@acme.test', 'Ann', 'Acme Global'];
    const again = await http()
      .post(`/sheet-syncs/${syncId}/run`)
      .set(auth())
      .expect(200);
    const job2 = await waitForJob(again.body.jobId);
    expect(job2).toMatchObject({ imported: 1, updated: 2 });
    expect(await lead('ann@acme.test')).toMatchObject({
      company: 'Acme Global',
    });
    expect(await lead('cara@corp.test')).toMatchObject({
      source: 'google_sheet',
    });

    const list = await http().get('/sheet-syncs').set(auth()).expect(200);
    expect(list.body[0]).toMatchObject({
      id: syncId,
      spreadsheet_title: 'Q4 leads',
      enabled: true,
      last_status: 'ok',
      job_imported: 1,
      job_updated: 2,
    });
  });

  it('records a clear error when the sheet is no longer shared', async () => {
    sheetsStatus = 403;
    const r = await http()
      .post(`/sheet-syncs/${syncId}/run`)
      .set(auth())
      .expect(400);
    expect(r.body.message).toMatch(
      /can't open that spreadsheet\. Share it with owner@gmail\.com/,
    );
    const s = await http().get('/sheet-syncs').set(auth()).expect(200);
    expect(s.body[0]).toMatchObject({ last_status: 'error' });
    sheetsStatus = 200;
  });

  it('the hourly job runs due syncs; paused ones are skipped', async () => {
    const age = (iv: string) =>
      withOrgContext(pool, orgId, (c) =>
        c.query(
          `UPDATE sheet_syncs SET last_synced_at = now() - $2::interval WHERE id = $1`,
          [syncId, iv],
        ),
      );
    const status = async () =>
      (
        await withOrgContext(pool, orgId, (c) =>
          c.query<{ last_status: string; last_synced_at: Date }>(
            `SELECT last_status, last_synced_at FROM sheet_syncs WHERE id = $1`,
            [syncId],
          ),
        )
      ).rows[0];

    await age('2 hours');
    await app.get(SheetsService).runDue();
    const ran = await status();
    expect(ran.last_status).toBe('ok');
    expect(Date.now() - new Date(ran.last_synced_at).getTime()).toBeLessThan(
      60_000,
    );

    await http()
      .patch(`/sheet-syncs/${syncId}`)
      .set(auth())
      .send({ enabled: false })
      .expect(200);
    await age('2 hours');
    await app.get(SheetsService).runDue();
    expect(
      Date.now() - new Date((await status()).last_synced_at).getTime(),
    ).toBeGreaterThan(3600_000);
  });

  it('disconnecting pauses syncs; deleting a sync keeps its leads', async () => {
    await http()
      .patch(`/sheet-syncs/${syncId}`)
      .set(auth())
      .send({ enabled: true })
      .expect(200);
    await http().delete('/integrations/google-sheets').set(auth()).expect(200);
    const s = await http().get('/sheet-syncs').set(auth()).expect(200);
    expect(s.body[0].enabled).toBe(false);
    await http().delete(`/sheet-syncs/${syncId}`).set(auth()).expect(200);
    expect(await lead('ann@acme.test')).toBeTruthy();
  });
});
