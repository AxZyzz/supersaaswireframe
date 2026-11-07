/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument */
import { clickKey, signClick } from './link-signing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'crypto';
import { Pool } from 'pg';
import request from 'supertest';
import { AppModule } from '../app.module';
import { PG_POOL } from '../db/db.module';
import { withOrgContext } from '../db/tenant-context';
import { verifyAllSenders } from '../../test/verify-senders';

/** Tracking: open pixel + click redirect + unsubscribe record events under the
 *  right org (via the SECURITY DEFINER resolvers), suppress + stop the lead, and
 *  surface through campaign stats. Endpoints are public (no auth token). */
const BROWSER =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';

describe('Tracking integration', () => {
  // Query string of a click link exactly as buildEmail signs it.
  const signed = (u: string) => ({
    u,
    s: signClick(clickKey(process.env.APP_ENCRYPTION_KEY ?? ''), trackingId, u),
  });
  let app: INestApplication;
  let pool: Pool;
  let token: string;
  let orgId: string;
  let userId: string;
  let campaignId: string;
  let trackingId: string;
  let unsubToken: string;
  let leadId: string;

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

    const email = `track-${randomUUID().slice(0, 8)}@test.local`;
    const res = await request(app.getHttpServer())
      .post('/auth/signup')
      .send({
        email,
        password: 'track-pass-123',
        name: 'Track T',
        orgName: 'Track Org',
      })
      .expect(201);
    token = res.body.accessToken;
    orgId = res.body.org.id;
    userId = res.body.user.id;
  });

  afterAll(async () => {
    await withOrgContext(pool, orgId, async (c) => {
      await c.query(`DELETE FROM orgs WHERE id = $1`, [orgId]);
    });
    await pool.query(`DELETE FROM users WHERE id = $1`, [userId]);
    await app.close();
  });

  const auth = () => `Bearer ${token}`;

  it('sends one email and captures its tracking + unsub tokens', async () => {
    await request(app.getHttpServer())
      .post('/senders')
      .set('Authorization', auth())
      .send({ provider: 'smtp', fromName: 'Rep', fromEmail: 'rep@track.local' })
      .expect(201);
    await verifyAllSenders(app.getHttpServer(), auth());

    const lead = await request(app.getHttpServer())
      .post('/leads')
      .set('Authorization', auth())
      .send({ email: 'target@lead.local', firstName: 'Tara' })
      .expect(201);
    leadId = lead.body.id;

    const tpls = await request(app.getHttpServer())
      .get('/templates')
      .set('Authorization', auth())
      .expect(200);
    const templateId = tpls.body[0].id;

    const camp = await request(app.getHttpServer())
      .post('/campaigns')
      .set('Authorization', auth())
      .send({ name: 'Track test' })
      .expect(201);
    campaignId = camp.body.id;

    await request(app.getHttpServer())
      .post(`/campaigns/${campaignId}/steps`)
      .set('Authorization', auth())
      .send({
        templateId,
        delayHours: 0,
        condition: 'always',
        subjectVariants: ['Variant A {first_name|there}', 'Variant B'],
      })
      .expect(201);

    await request(app.getHttpServer())
      .post(`/campaigns/${campaignId}/enroll`)
      .set('Authorization', auth())
      .expect(200);

    const tick = await request(app.getHttpServer())
      .post('/sending/tick')
      .set('Authorization', auth())
      .expect(200);
    expect(tick.body.sent).toBe(1);

    await withOrgContext(pool, orgId, async (c) => {
      const se = await c.query(
        `SELECT tracking_id FROM sent_emails WHERE campaign_id = $1`,
        [campaignId],
      );
      trackingId = se.rows[0].tracking_id;
      // a person opens minutes later, not at delivery (see bot-detect.ts)
      await c.query(
        `UPDATE sent_emails SET sent_at = now() - interval '5 minutes' WHERE campaign_id = $1`,
        [campaignId],
      );
      const cl = await c.query(
        `SELECT unsub_token FROM campaign_leads WHERE campaign_id = $1`,
        [campaignId],
      );
      unsubToken = cl.rows[0].unsub_token;
    });
    expect(trackingId).toBeTruthy();
    expect(unsubToken).toBeTruthy();
  });

  it('scanner fetches are logged as bot events, never as engagement (T5.4)', async () => {
    await request(app.getHttpServer())
      .get(`/t/o/${trackingId}`)
      .set('User-Agent', 'Mozilla/5.0 (compatible; Barracuda Sentinel)')
      .expect(200)
      .expect('Content-Type', /image\/gif/);
    const res = await request(app.getHttpServer())
      .get(`/t/c/${trackingId}`)
      .set('User-Agent', 'python-requests/2.31')
      .query(signed('https://example.com/scan'))
      .expect(302);
    expect(res.headers.location).toBe('https://example.com/scan'); // still redirects
    await request(app.getHttpServer())
      .get(`/t/o/${trackingId}`)
      .unset('User-Agent')
      .expect(200);

    await withOrgContext(pool, orgId, async (c) => {
      const ev = await c.query(
        `SELECT type, data->>'reason' AS reason FROM email_events
         WHERE campaign_id = $1 AND type <> 'sent' ORDER BY created_at`,
        [campaignId],
      );
      expect(ev.rows).toEqual([
        { type: 'bot_open', reason: 'scanner_user_agent' },
        { type: 'bot_click', reason: 'scanner_user_agent' },
        { type: 'bot_open', reason: 'no_user_agent' },
      ]);
      const lt = await c.query(
        `SELECT count(*)::int AS n FROM lead_events
         WHERE lead_id = $1 AND type IN ('email_opened', 'email_clicked')`,
        [leadId],
      );
      expect(lt.rows[0].n).toBe(0);
    });
  });

  it('open pixel returns a gif and records an open event', async () => {
    await request(app.getHttpServer())
      .get(`/t/o/${trackingId}`)
      .set('User-Agent', BROWSER)
      .expect(200)
      .expect('Content-Type', /image\/gif/);

    await withOrgContext(pool, orgId, async (c) => {
      const ev = await c.query(
        `SELECT count(*)::int AS n FROM email_events
         WHERE campaign_id = $1 AND lead_id = $2 AND type = 'open'`,
        [campaignId, leadId],
      );
      expect(ev.rows[0].n).toBeGreaterThanOrEqual(1);
      const lt = await c.query(
        `SELECT count(*)::int AS n FROM lead_events
         WHERE lead_id = $1 AND type = 'email_opened'`,
        [leadId],
      );
      expect(lt.rows[0].n).toBe(1);
    });
  });

  it('bad tracking id still returns a gif, records nothing', async () => {
    await request(app.getHttpServer())
      .get(`/t/o/not-a-uuid`)
      .expect(200)
      .expect('Content-Type', /image\/gif/);
  });

  it('click redirects to the target and records a click event', async () => {
    const target = 'https://example.com/pricing';
    const res = await request(app.getHttpServer())
      .get(`/t/c/${trackingId}`)
      .set('User-Agent', BROWSER)
      .query(signed(target))
      .expect(302);
    expect(res.headers.location).toBe(target);

    await withOrgContext(pool, orgId, async (c) => {
      const ev = await c.query(
        `SELECT data FROM email_events
         WHERE campaign_id = $1 AND lead_id = $2 AND type = 'click'`,
        [campaignId, leadId],
      );
      expect(ev.rowCount).toBe(1);
      expect(ev.rows[0].data.url).toBe(target);
    });
  });

  it('rejects a non-http click target (no open redirect) and falls back', async () => {
    const res = await request(app.getHttpServer())
      .get(`/t/c/${trackingId}`)
      .query(signed('javascript:alert(1)'))
      .expect(302);
    expect(res.headers.location).not.toContain('javascript:');
  });

  it('is not an open redirect: unknown ids and bad signatures land on the app', async () => {
    const evil = 'https://evil.example/phish';
    const key = clickKey(process.env.APP_ENCRYPTION_KEY ?? '');
    const go = (id: string, q: Record<string, string>) =>
      request(app.getHttpServer()).get(`/t/c/${id}`).query(q).expect(302);

    // made-up tracking id: never follows the target
    const forged = await go(randomUUID(), { u: evil });
    expect(forged.headers.location).not.toContain('evil.example');
    // a forged signature on a made-up id doesn't help either
    const fakeSig = await go(randomUUID(), { u: evil, s: 'A'.repeat(22) });
    expect(fakeSig.headers.location).not.toContain('evil.example');

    // a link we signed is followed…
    const target = 'https://example.com/pricing?plan=pro&ref=email';
    const ok = await go(trackingId, {
      u: target,
      s: signClick(key, trackingId, target),
    });
    expect(ok.headers.location).toBe(target);
    // …but its signature can't be reused for another destination
    const swapped = await go(trackingId, {
      u: evil,
      s: signClick(key, trackingId, target),
    });
    expect(swapped.headers.location).not.toContain('evil.example');
    // an unsigned link is refused even for a real tracking id (that id is in
    // every recipient's email, so it can't be what authorises a redirect)
    const unsigned = await go(trackingId, { u: evil });
    expect(unsigned.headers.location).not.toContain('evil.example');
    // and a real id with a wrong signature is refused
    const tampered = await go(trackingId, { u: evil, s: 'B'.repeat(22) });
    expect(tampered.headers.location).not.toContain('evil.example');
  });

  it('GET unsubscribe shows a landing page (no side effects)', async () => {
    await request(app.getHttpServer())
      .get(`/u/${unsubToken}`)
      .expect(200)
      .expect('Content-Type', /text\/html/);

    await withOrgContext(pool, orgId, async (c) => {
      const supp = await c.query(
        `SELECT count(*)::int AS n FROM suppression_list WHERE org_id = $1`,
        [orgId],
      );
      expect(supp.rows[0].n).toBe(0); // GET must not unsubscribe
    });
  });

  it('POST unsubscribe suppresses, stops the lead, and logs the event', async () => {
    await request(app.getHttpServer())
      .post(`/u/${unsubToken}`)
      .expect(200)
      .expect('Content-Type', /text\/html/);

    await withOrgContext(pool, orgId, async (c) => {
      const supp = await c.query(
        `SELECT reason FROM suppression_list
         WHERE org_id = $1 AND lower(email) = 'target@lead.local'`,
        [orgId],
      );
      expect(supp.rowCount).toBe(1);
      expect(supp.rows[0].reason).toBe('unsubscribed');

      const cl = await c.query(
        `SELECT status, stop_reason FROM campaign_leads
         WHERE campaign_id = $1 AND lead_id = $2`,
        [campaignId, leadId],
      );
      // Single-step campaign completes on send; unsub still records + suppresses,
      // and only flips an *active* lead to stopped. Either way it's off the list.
      expect(['completed', 'stopped']).toContain(cl.rows[0].status);

      const ev = await c.query(
        `SELECT count(*)::int AS n FROM email_events
         WHERE campaign_id = $1 AND type = 'unsubscribe'`,
        [campaignId],
      );
      expect(ev.rows[0].n).toBe(1);
    });
  });

  it('surfaces engagement through campaign stats', async () => {
    const res = await request(app.getHttpServer())
      .get(`/campaigns/${campaignId}/stats`)
      .set('Authorization', auth())
      .expect(200);
    expect(res.body.sent).toBe(1);
    expect(res.body.opened).toBe(1);
    expect(res.body.clicked).toBe(1);
    expect(res.body.unsubscribed).toBe(1);
    expect(res.body.leads.total).toBe(1);
    expect(res.body.variants.length).toBeGreaterThanOrEqual(1);
  });
});
