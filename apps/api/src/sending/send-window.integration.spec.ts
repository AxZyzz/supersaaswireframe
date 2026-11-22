/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-return */
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'crypto';
import { Pool } from 'pg';
import request from 'supertest';
import { AppModule } from '../app.module';
import { PG_POOL } from '../db/db.module';
import { withOrgContext } from '../db/tenant-context';
import { verifyAllSenders } from '../../test/verify-senders';
import { SendService } from './send.service';
import { isInsideWindow, type SendWindow } from './send-window';

jest.setTimeout(120_000);

/**
 * Learning Loop T17: send windows and the send-time test. Time is a FAKE clock
 * (SendService.clock) so one test can walk across a night, a weekend and a DST
 * change. The database clock still decides what is "due"; after the service
 * moves a lead's next_send_at, the test rewinds it to the database's now() and
 * moves the fake clock to that instant: "the time has come".
 */
describe('Send windows + send-time test (T17)', () => {
  let app: INestApplication;
  let pool: Pool;
  let send: SendService;
  let token: string;
  let orgId: string;
  let userId: string;
  let templateId: string;

  const http = () => request(app.getHttpServer());
  const auth = () => `Bearer ${token}`;
  const at = (iso: string) => {
    send.clock = () => new Date(iso);
  };
  const tick = async () =>
    (
      await http()
        .post('/sending/tick')
        .set('Authorization', auth())
        .expect(200)
    ).body as Record<string, number>;
  const q = <T = any>(sql: string, params: unknown[] = []) =>
    withOrgContext(
      pool,
      orgId,
      async (c) => (await c.query(sql, params)).rows as T[],
    );

  /** Time has come: due in the database, and the fake clock says `iso`. */
  const itIsNow = async (campaignId: string, iso: string) => {
    await q(
      `UPDATE campaign_leads SET next_send_at = now() - interval '1 minute'
        WHERE campaign_id = $1 AND status = 'active'`,
      [campaignId],
    );
    at(iso);
  };

  const WIN_TUE_THU_9_11: SendWindow = {
    days: [2, 3, 4],
    startHour: 9,
    endHour: 11,
    tzBasis: 'recipient',
  };
  const WIN_TUE_THU_14_16: SendWindow = {
    days: [2, 3, 4],
    startHour: 14,
    endHour: 16,
    tzBasis: 'recipient',
  };

  /** Leads in a fresh manual segment. tz = the lead's timezone (or none). */
  async function leadsIn(
    specs: { email: string; tz?: string | null }[],
  ): Promise<{ segmentId: string; leadIds: string[] }> {
    const seg = await http()
      .post('/segments')
      .set('Authorization', auth())
      .send({ name: `Seg-${randomUUID().slice(0, 8)}`, type: 'manual' })
      .expect(201);
    const leadIds: string[] = [];
    for (const s of specs) {
      const l = await http()
        .post('/leads')
        .set('Authorization', auth())
        .send({ email: s.email, firstName: s.email.split('@')[0] })
        .expect(201);
      leadIds.push(l.body.id);
      await q(`UPDATE leads SET timezone = $2 WHERE id = $1`, [
        l.body.id,
        s.tz ?? null,
      ]);
    }
    await http()
      .post(`/segments/${seg.body.id}/members`)
      .set('Authorization', auth())
      .send({ leadIds })
      .expect(200);
    return { segmentId: seg.body.id, leadIds };
  }

  async function campaignWith(opts: {
    segmentId: string;
    sendWindow?: SendWindow | null;
    steps?: number[]; // delayHours per step
  }) {
    const camp = await http()
      .post('/campaigns')
      .set('Authorization', auth())
      .send({
        name: `C-${randomUUID().slice(0, 8)}`,
        segmentId: opts.segmentId,
        ...(opts.sendWindow ? { sendWindow: opts.sendWindow } : {}),
      })
      .expect(201);
    const stepIds: string[] = [];
    for (const delayHours of opts.steps ?? [0]) {
      const s = await http()
        .post(`/campaigns/${camp.body.id}/steps`)
        .set('Authorization', auth())
        .send({ templateId, delayHours })
        .expect(201);
      stepIds.push(s.body.id);
    }
    return { id: camp.body.id as string, stepIds };
  }

  const enroll = (id: string) =>
    http()
      .post(`/campaigns/${id}/enroll`)
      .set('Authorization', auth())
      .expect(200);

  const nextSendAts = async (campaignId: string) =>
    (
      await q<{ email: string; next_send_at: Date | null; status: string }>(
        `SELECT l.email, cl.next_send_at, cl.status
           FROM campaign_leads cl JOIN leads l ON l.id = cl.lead_id
          WHERE cl.campaign_id = $1 ORDER BY l.email`,
        [campaignId],
      )
    ).map((r) => ({ ...r, ms: r.next_send_at?.getTime() ?? null }));

  beforeAll(async () => {
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
    send = app.get(SendService);

    const r = await http()
      .post('/auth/signup')
      .send({
        email: `t17-${randomUUID().slice(0, 8)}@test.local`,
        password: 't17-password-123',
        name: 'T17',
        orgName: 'T17 Org',
      })
      .expect(201);
    token = r.body.accessToken;
    orgId = r.body.org.id;
    userId = r.body.user.id;

    await http()
      .post('/senders')
      .set('Authorization', auth())
      .send({
        provider: 'smtp',
        fromName: 'T17 Rep',
        fromEmail: 'rep@t17.local',
        dailyLimit: 500,
      })
      .expect(201);
    await verifyAllSenders(app.getHttpServer(), auth());
    await q(
      `UPDATE sender_accounts SET warmup_enabled = false, daily_limit = 500`,
    );
    const tpls = await http()
      .get('/templates')
      .set('Authorization', auth())
      .expect(200);
    templateId = tpls.body[0].id;
  });

  afterEach(async () => {
    send.clock = () => new Date();
    // Isolation: a tick sends for EVERY due lead in the workspace, so park what
    // a finished test leaves behind (the due scan only reads active/scheduled).
    await q(`UPDATE campaigns SET status = 'paused'`);
  });

  afterAll(async () => {
    delete process.env.THROTTLE_DISABLED;
    await withOrgContext(pool, orgId, (c) =>
      c.query(`DELETE FROM orgs WHERE id = $1`, [orgId]),
    );
    await pool.query(`DELETE FROM users WHERE id = $1`, [userId]);
    await app.close();
  });

  // ── acceptance criterion 1 ────────────────────────────────────────────

  it("a campaign with a window only sends inside it, in each recipient's own timezone", async () => {
    await q(`UPDATE orgs SET timezone = 'UTC' WHERE id = $1`, [orgId]);
    const { segmentId } = await leadsIn([
      { email: 'kolkata@in.t17.test', tz: 'Asia/Kolkata' },
      { email: 'newyork@us.t17.test', tz: 'America/New_York' },
      { email: 'unknown@xx.t17.test', tz: null }, // read on the workspace clock (UTC)
    ]);
    const camp = await campaignWith({
      segmentId,
      sendWindow: WIN_TUE_THU_9_11,
    });
    await enroll(camp.id);

    // Tuesday 2026-11-24 04:00Z: 09:30 in Kolkata (inside), 23:00 Monday in
    // New York (outside), 04:00 in UTC (outside)
    at('2026-11-24T04:00:00Z');
    const t1 = await tick();
    expect(t1.sent).toBe(1);
    expect(t1.deferred).toBe(2);

    const sent = await q(
      `SELECT to_email FROM sent_emails WHERE campaign_id = $1`,
      [camp.id],
    );
    expect(sent.map((s) => s.to_email)).toEqual(['kolkata@in.t17.test']);

    // the others were not dropped: moved to the NEXT opening on their own clock
    const pending = await nextSendAts(camp.id);
    const ny = pending.find((p) => p.email === 'newyork@us.t17.test')!;
    const utc = pending.find((p) => p.email === 'unknown@xx.t17.test')!;
    // New York: Tue 09:00-11:00 EST = 14:00Z-16:00Z
    expect(ny.ms!).toBeGreaterThanOrEqual(Date.parse('2026-11-24T14:00:00Z'));
    expect(ny.ms!).toBeLessThan(Date.parse('2026-11-24T16:00:00Z'));
    // unknown timezone -> workspace (UTC): Tue 09:00-11:00Z
    expect(utc.ms!).toBeGreaterThanOrEqual(Date.parse('2026-11-24T09:00:00Z'));
    expect(utc.ms!).toBeLessThan(Date.parse('2026-11-24T11:00:00Z'));
    expect(ny.status).toBe('active');

    // while the clock has not moved, a second tick sends nothing new
    await itIsNow(camp.id, '2026-11-24T04:30:00Z');
    expect((await tick()).sent).toBe(0);

    // the opening arrives in New York (10:00 EST = 15:00Z): New York sends, UTC still waits
    await itIsNow(camp.id, '2026-11-24T15:00:00Z');
    const t3 = await tick();
    expect(t3.sent).toBe(1);
    expect(
      (
        await q(
          `SELECT to_email FROM sent_emails WHERE campaign_id = $1 ORDER BY sent_at`,
          [camp.id],
        )
      ).map((s) => s.to_email),
    ).toEqual(['kolkata@in.t17.test', 'newyork@us.t17.test']);
    // the UTC lead: 15:00 UTC is past its 09:00-11:00 UTC window, so it waits for Wednesday
    expect(t3.deferred).toBe(1);
    const utcNow = (await nextSendAts(camp.id)).find(
      (p) => p.email === 'unknown@xx.t17.test',
    )!;
    expect(utcNow.ms!).toBeGreaterThanOrEqual(
      Date.parse('2026-11-25T09:00:00Z'),
    );
    expect(utcNow.ms!).toBeLessThan(Date.parse('2026-11-25T11:00:00Z'));
  });

  it('after the window closes the send moves to the next window day: across a weekend and a DST change (workspace clock)', async () => {
    await q(`UPDATE orgs SET timezone = 'America/New_York' WHERE id = $1`, [
      orgId,
    ]);
    const { segmentId } = await leadsIn([
      { email: 'friday@dst.t17.test', tz: null },
    ]);
    const wk: SendWindow = {
      days: [1, 2, 3, 4, 5],
      startHour: 9,
      endHour: 17,
      tzBasis: 'workspace',
    };
    const camp = await campaignWith({ segmentId, sendWindow: wk });
    await enroll(camp.id);

    // Friday 2026-03-06 17:30 EST (22:30Z): the window just closed
    at('2026-03-06T22:30:00Z');
    const t1 = await tick();
    expect(t1.sent).toBe(0);
    expect(t1.deferred).toBe(1);
    const [row] = await nextSendAts(camp.id);
    // Monday 2026-03-09 is EDT (clocks went forward on Sunday 03-08): 09:00-17:00 EDT = 13:00Z-21:00Z
    expect(row.ms!).toBeGreaterThanOrEqual(Date.parse('2026-03-09T13:00:00Z'));
    expect(row.ms!).toBeLessThan(Date.parse('2026-03-09T21:00:00Z'));

    // Saturday: still nothing, and nothing moves to a weekend
    await itIsNow(camp.id, '2026-03-07T15:00:00Z');
    expect((await tick()).sent).toBe(0);
    const [sat] = await nextSendAts(camp.id);
    expect(sat.ms!).toBeGreaterThanOrEqual(Date.parse('2026-03-09T13:00:00Z'));

    // Monday morning it goes out
    await itIsNow(camp.id, new Date(row.ms!).toISOString());
    expect((await tick()).sent).toBe(1);
    await q(`UPDATE orgs SET timezone = 'UTC' WHERE id = $1`, [orgId]);
  });

  it('a lead that was already inside the window is not delayed, and caps still apply inside it', async () => {
    const { segmentId } = await leadsIn(
      ['a', 'b', 'c', 'd', 'e'].map((n) => ({
        email: `${n}@cap.t17.test`,
        tz: 'Asia/Kolkata',
      })),
    );
    const allDay: SendWindow = {
      days: [1, 2, 3, 4, 5, 6, 7],
      startHour: 0,
      endHour: 24,
      tzBasis: 'recipient',
    };
    const camp = await campaignWith({ segmentId, sendWindow: allDay });
    await enroll(camp.id);
    // the sender has already sent today in the tests above: allow exactly 2 more
    const [{ n }] = await q<{ n: number }>(
      `SELECT count(*)::int AS n FROM sent_emails
        WHERE status = 'sent' AND sent_at::date = current_date`,
    );
    await q(`UPDATE sender_accounts SET daily_limit = $1`, [n + 2]);
    at('2026-11-25T05:00:00Z');
    const t = await tick();
    expect(t.sent).toBe(2); // the sender's daily cap, not the window, decides here
    expect(t.deferred).toBe(3);
    await q(`UPDATE sender_accounts SET daily_limit = 500`);
  });

  it('1,000-lead style backlog: deferred sends are spread across the window, not fired at the opening', async () => {
    const specs = Array.from({ length: 30 }, (_, i) => ({
      email: `lead${i}@spread-${i}.t17.test`,
      tz: 'Asia/Kolkata',
    }));
    const { segmentId } = await leadsIn(specs);
    const camp = await campaignWith({
      segmentId,
      sendWindow: WIN_TUE_THU_9_11,
    });
    await enroll(camp.id);

    // Wednesday 2026-11-25 01:00 IST (19:30Z Tuesday): the window is closed
    at('2026-11-24T19:30:00Z');
    const t = await tick();
    expect(t.sent).toBe(0);
    expect(t.deferred).toBe(30);

    const times = (await nextSendAts(camp.id)).map((r) => r.ms!);
    // Wednesday 09:00-11:00 IST = 03:30Z-05:30Z
    const open = Date.parse('2026-11-25T03:30:00Z');
    const close = Date.parse('2026-11-25T05:30:00Z');
    expect(Math.min(...times)).toBeGreaterThanOrEqual(open);
    expect(Math.max(...times)).toBeLessThan(close);
    expect(
      new Set(times.map((m) => Math.floor(m / 60_000))).size,
    ).toBeGreaterThanOrEqual(15);
    expect(times.filter((m) => m > open + 3_600_000).length).toBeGreaterThan(5);
  });

  it('a legacy campaign without a window is untouched: it sends at any hour on any day', async () => {
    const { segmentId } = await leadsIn([
      { email: 'legacy@legacy.t17.test', tz: 'Asia/Kolkata' },
    ]);
    const camp = await campaignWith({ segmentId });
    const got = await http()
      .get(`/campaigns/${camp.id}`)
      .set('Authorization', auth())
      .expect(200);
    expect(got.body.send_window).toBeNull();
    await enroll(camp.id);
    at('2026-11-22T21:00:00Z'); // a Sunday, 02:30 in Kolkata on Monday
    const t = await tick();
    expect(t.sent).toBe(1);
    expect(t.deferred).toBe(0);
  });

  // ── window setup: validation, freeze, duplicate ────────────────────────

  it('rejects bad windows in plain words, accepts and clears a good one, and copies it on duplicate', async () => {
    const camp = await http()
      .post('/campaigns')
      .set('Authorization', auth())
      .send({ name: `W-${randomUUID().slice(0, 6)}` })
      .expect(201);
    const patch = (sendWindow: unknown) =>
      http()
        .patch(`/campaigns/${camp.body.id}`)
        .set('Authorization', auth())
        .send({ sendWindow });

    const bad = await patch({
      ...WIN_TUE_THU_9_11,
      startHour: 22,
      endHour: 6,
    }).expect(400);
    expect(bad.body.error).toBe('invalid_send_window');
    expect(bad.body.message).toMatch(/overnight/i);
    await patch({ ...WIN_TUE_THU_9_11, days: [] }).expect(400);
    await patch({ ...WIN_TUE_THU_9_11, tzBasis: 'sender' }).expect(400);

    const ok = await patch({ ...WIN_TUE_THU_9_11, days: [4, 2, 3] }).expect(
      200,
    );
    expect(ok.body.send_window).toEqual(WIN_TUE_THU_9_11); // days sorted

    const dup = await http()
      .post(`/campaigns/${camp.body.id}/duplicate`)
      .set('Authorization', auth())
      .expect(201);
    expect(dup.body.send_window).toEqual(WIN_TUE_THU_9_11);

    const cleared = await patch(null).expect(200);
    expect(cleared.body.send_window).toBeNull();
  });

  // ── acceptance criterion 2: the send-time test ────────────────────────

  it('runs a send-time test: stable assignment per company, one subject, arms follow their windows, Review compares the windows', async () => {
    await q(`UPDATE orgs SET timezone = 'UTC' WHERE id = $1`, [orgId]);
    // 20 companies in Kolkata, the first one with a second contact
    const specs = Array.from({ length: 20 }, (_, i) => ({
      email: `owner@co-${i}.sendtime.test`,
      tz: 'Asia/Kolkata',
    }));
    specs.push({ email: 'second@co-0.sendtime.test', tz: 'Asia/Kolkata' });
    const { segmentId } = await leadsIn(specs);
    const camp = await campaignWith({ segmentId, steps: [0, 0] }); // two steps, follow-up due at once

    // set up: two different windows, same clock, a draft first
    const created = await http()
      .post(`/campaigns/${camp.id}/experiments`)
      .set('Authorization', auth())
      .send({
        kind: 'send_time',
        windows: [
          { label: 'A', window: WIN_TUE_THU_9_11 },
          { label: 'B', window: WIN_TUE_THU_14_16 },
        ],
      })
      .expect(201);
    expect(created.body.kind).toBe('send_time');
    const armsCreated = created.body.variants as {
      id: string;
      label: string;
      subject: string;
      send_window: unknown;
    }[];
    const vA = armsCreated.find((v) => v.label === 'A')!;
    const vB = armsCreated.find((v) => v.label === 'B')!;
    expect(vA.send_window).toEqual(WIN_TUE_THU_9_11);
    expect(vB.send_window).toEqual(WIN_TUE_THU_14_16);
    expect(vA.subject).toBe(vB.subject); // identical subjects in both arms
    const exp = created.body.id as string;
    // both arms are inserted in one transaction, so their order is (created_at, id):
    // A is not necessarily first, and variant_index is the position in THAT order
    const order = (
      await q<{ id: string }>(
        `SELECT id FROM experiment_variants WHERE experiment_id = $1 ORDER BY created_at, id`,
        [exp],
      )
    ).map((r) => r.id);
    const indexOf = (id: string) => order.indexOf(id);

    await http()
      .post(`/experiments/${exp}/start`)
      .set('Authorization', auth())
      .expect(200);
    await enroll(camp.id);

    // Tuesday 04:00Z = 09:30 IST: arm A is open, arm B is not (14:00-16:00 IST = 08:30Z-10:30Z)
    at('2026-11-24T04:00:00Z');
    const t1 = await tick();
    expect(t1.sent + t1.deferred).toBe(21);
    expect(t1.sent).toBeGreaterThan(0);
    expect(t1.deferred).toBeGreaterThan(0);

    const assigns = await q<{ company_key: string; variant_id: string }>(
      `SELECT company_key, variant_id FROM experiment_assignments WHERE experiment_id = $1`,
      [exp],
    );
    expect(assigns).toHaveLength(20); // one per company, however many contacts
    const armOf = new Map(
      assigns.map((a) => [a.company_key, a.variant_id === vA.id ? 'A' : 'B']),
    );
    expect(new Set(armOf.values())).toEqual(new Set(['A', 'B']));

    // everything sent so far is an arm-A company, credited to A, with the same subject
    const sent1 = await q<{
      to_email: string;
      variant_id: string;
      experiment_id: string;
      variant_index: number;
      subject: string;
    }>(
      `SELECT to_email, variant_id, experiment_id, variant_index, subject
         FROM sent_emails WHERE campaign_id = $1 AND status = 'sent'`,
      [camp.id],
    );
    expect(sent1.length).toBeGreaterThan(0);
    for (const s of sent1) {
      const company = s.to_email.split('@')[1];
      expect(armOf.get(company)).toBe('A');
      expect(s.variant_id).toBe(vA.id);
      expect(s.experiment_id).toBe(exp);
      expect(s.variant_index).toBe(indexOf(vA.id));
    }
    expect(new Set(sent1.map((s) => s.subject)).size).toBe(1);

    // two contacts at co-0 share ONE assignment, so they share the arm and its window
    const co0Arm = armOf.get('co-0.sendtime.test');
    const co0Sent = sent1.filter((s) =>
      s.to_email.endsWith('@co-0.sendtime.test'),
    );
    if (co0Arm === 'A') {
      expect(co0Sent).toHaveLength(2); // both went out in window A
    } else {
      expect(co0Sent).toHaveLength(0); // both wait for window B
      const co0 = (await nextSendAts(camp.id)).filter((r) =>
        r.email.endsWith('@co-0.sendtime.test'),
      );
      expect(co0).toHaveLength(2);
      for (const r of co0) {
        expect(
          isInsideWindow(WIN_TUE_THU_14_16, r.next_send_at!, 'Asia/Kolkata'),
        ).toBe(true);
      }
    }

    // arm B companies are waiting for their own window
    const waiting = (await nextSendAts(camp.id)).filter(
      (r) => armOf.get(r.email.split('@')[1]) === 'B' && r.status === 'active',
    );
    expect(waiting.length).toBeGreaterThan(0);
    for (const w of waiting) {
      expect(w.ms!).toBeGreaterThanOrEqual(Date.parse('2026-11-24T08:30:00Z'));
      expect(w.ms!).toBeLessThan(Date.parse('2026-11-24T10:30:00Z'));
    }

    // 09:00Z (14:30 IST): arm B opens, arm A's window has closed
    await itIsNow(camp.id, '2026-11-24T09:00:00Z');
    await tick(); // arm B's first touches go out; arm A's follow-ups find window A closed
    await tick(); // arm B's follow-ups are due at once and still inside window B
    const sentAll = await q<{
      to_email: string;
      variant_id: string;
      step_order: number;
    }>(
      `SELECT se.to_email, se.variant_id, cs.step_order
         FROM sent_emails se JOIN campaign_steps cs ON cs.id = se.step_id
        WHERE se.campaign_id = $1 AND se.status = 'sent' AND cs.step_order = 0`,
      [camp.id],
    );
    // every company's FIRST touch is now sent exactly once, in the right arm
    expect(sentAll).toHaveLength(21);
    for (const s of sentAll) {
      const arm = armOf.get(s.to_email.split('@')[1]);
      expect(s.variant_id).toBe(arm === 'A' ? vA.id : vB.id);
    }
    // assignments did not grow or change: stable
    const after = await q(
      `SELECT count(*)::int AS n FROM experiment_assignments WHERE experiment_id = $1`,
      [exp],
    );
    expect(after[0].n).toBe(20);

    // follow-ups (step 2) follow the company's arm window: with the clock at
    // 09:00Z (14:30 IST) an arm-A follow-up is outside window A, so it waits
    // for A's NEXT opening (Wednesday 09:00-11:00 IST), while arm B sends now
    const followUps = await q<{ to_email: string }>(
      `SELECT se.to_email FROM sent_emails se JOIN campaign_steps cs ON cs.id = se.step_id
        WHERE se.campaign_id = $1 AND cs.step_order = 1`,
      [camp.id],
    );
    expect(followUps.length).toBeGreaterThan(0);
    for (const f of followUps)
      expect(armOf.get(f.to_email.split('@')[1])).toBe('B');
    const waitingA = (await nextSendAts(camp.id)).filter(
      (r) => armOf.get(r.email.split('@')[1]) === 'A' && r.status === 'active',
    );
    expect(waitingA.length).toBeGreaterThan(0);
    for (const w of waitingA) {
      expect(
        isInsideWindow(WIN_TUE_THU_9_11, w.next_send_at!, 'Asia/Kolkata'),
      ).toBe(true);
      expect(w.ms!).toBeGreaterThanOrEqual(Date.parse('2026-11-25T03:30:00Z')); // Wednesday
    }

    // the Review tab compares the two WINDOWS
    const review = await http()
      .post(`/campaigns/${camp.id}/review/refresh`)
      .set('Authorization', auth());
    const rv =
      review.status === 200 || review.status === 201
        ? review.body
        : (
            await http()
              .get(`/campaigns/${camp.id}/review`)
              .set('Authorization', auth())
              .expect(200)
          ).body;
    const view = rv as {
      id: string;
      experiment: {
        kind: string;
        arms: { label: string; windowText: string | null }[];
      };
      result: {
        arms: { assigned: number }[];
        allowedActions: { type: string }[];
      };
    };
    expect(view.experiment.kind).toBe('send_time');
    const windowOf = (label: string) =>
      view.experiment.arms.find((a) => a.label === label)?.windowText;
    expect(windowOf('A')).toBe('Tue-Thu 09:00-11:00 (recipient time)');
    expect(windowOf('B')).toBe('Tue-Thu 14:00-16:00 (recipient time)');
    expect(view.result.arms).toHaveLength(2);
    expect(view.result.arms.reduce((n, a) => n + a.assigned, 0)).toBe(20);
    // an AI challenger makes no sense for a send-time test: not offered, and refused if asked
    expect(
      view.result.allowedActions.some((a) => a.type === 'draft_challenger'),
    ).toBe(false);
    const drafts = await http()
      .post(`/reviews/${rv.id}/challenger-drafts`)
      .set('Authorization', auth());
    expect(drafts.status).toBe(400);

    // frozen while running: the windows, the campaign window, and a second test
    await http()
      .patch(`/experiments/${exp}`)
      .set('Authorization', auth())
      .send({
        windows: [{ window: WIN_TUE_THU_14_16 }, { window: WIN_TUE_THU_9_11 }],
      })
      .expect(409);
    const frozen = await http()
      .patch(`/campaigns/${camp.id}`)
      .set('Authorization', auth())
      .send({ sendWindow: WIN_TUE_THU_14_16 })
      .expect(409);
    expect(frozen.body.error).toBe('experiment_running');
    // one test at a time: on an ACTIVE campaign no test can be set up at all (T02
    // rule); once paused, a second test is refused because this one is running
    await http()
      .post(`/campaigns/${camp.id}/experiments`)
      .set('Authorization', auth())
      .send({ variants: [{ subject: 'x' }, { subject: 'y' }] })
      .expect(400);
    await http()
      .post(`/campaigns/${camp.id}/pause`)
      .set('Authorization', auth())
      .expect(200);
    const second = await http()
      .post(`/campaigns/${camp.id}/experiments`)
      .set('Authorization', auth())
      .send({ variants: [{ subject: 'x' }, { subject: 'y' }] })
      .expect(409);
    expect(second.body.error).toBe('experiment_running');
  });

  it('refuses a send-time test whose two arms would differ by more than time', async () => {
    const { segmentId } = await leadsIn([
      { email: 'x@setup.t17.test', tz: 'Asia/Kolkata' },
    ]);
    const camp = await campaignWith({ segmentId });
    const post = (body: object) =>
      http()
        .post(`/campaigns/${camp.id}/experiments`)
        .set('Authorization', auth())
        .send(body);

    const same = await post({
      kind: 'send_time',
      windows: [{ window: WIN_TUE_THU_9_11 }, { window: WIN_TUE_THU_9_11 }],
    }).expect(400);
    expect(same.body.error).toBe('windows_identical');

    const clocks = await post({
      kind: 'send_time',
      windows: [
        { window: WIN_TUE_THU_9_11 },
        { window: { ...WIN_TUE_THU_14_16, tzBasis: 'workspace' } },
      ],
    }).expect(400);
    expect(clocks.body.error).toBe('window_clock_mismatch');

    const bad = await post({
      kind: 'send_time',
      windows: [
        { window: WIN_TUE_THU_9_11 },
        { window: { ...WIN_TUE_THU_14_16, days: [] } },
      ],
    }).expect(400);
    expect(bad.body.message).toMatch(/^Window B:/);

    await post({
      kind: 'send_time',
      windows: [{ window: WIN_TUE_THU_9_11 }],
    }).expect(400);

    // step 1 rotating between two subjects (no winner) would change the subject too
    await q(
      `UPDATE campaign_steps SET subject_variants = '["One","Two"]'::jsonb WHERE id = $1`,
      [camp.stepIds[0]],
    );
    const rot = await post({
      kind: 'send_time',
      windows: [{ window: WIN_TUE_THU_9_11 }, { window: WIN_TUE_THU_14_16 }],
    }).expect(400);
    expect(rot.body.error).toBe('subject_rotation_on_step');
  });
});
