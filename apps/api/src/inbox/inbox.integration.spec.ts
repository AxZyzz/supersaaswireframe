/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-call */
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'crypto';
import { Pool } from 'pg';
import request from 'supertest';
import { AppModule } from '../app.module';
import { PG_POOL } from '../db/db.module';
import { withOrgContext } from '../db/tenant-context';
import { MockProvider } from '../senders/providers/mock.provider';

/** E7 chunk 1: reply ingestion threads replies into conversations, classifies
 *  them, and applies sequence automations (stop-on-reply, out-of-office
 *  reschedule, not-interested tag). Read side: list/filter, thread, read state. */
describe('Inbox integration', () => {
  let app: INestApplication;
  let pool: Pool;
  let token: string;
  let orgId: string;
  let userId: string;
  let campaignId: string;
  let conversationId: string;

  const auth = () => `Bearer ${token}`;
  const http = () => request(app.getHttpServer());

  const enrollmentOf = async (email: string) => {
    let row:
      | {
          status: string;
          stop_reason: string | null;
          next_send_at: Date | null;
        }
      | undefined;
    await withOrgContext(pool, orgId, async (c) => {
      const r = await c.query(
        `SELECT cl.status, cl.stop_reason, cl.next_send_at
         FROM campaign_leads cl JOIN leads l ON l.id = cl.lead_id
         WHERE cl.campaign_id = $1 AND l.email = $2`,
        [campaignId, email],
      );
      row = r.rows[0];
    });
    return row!;
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

    const res = await http()
      .post('/auth/signup')
      .send({
        email: `ib-${randomUUID().slice(0, 8)}@test.local`,
        password: 'ib-pass-123',
        name: 'Ib T',
        orgName: 'Ib Org',
      })
      .expect(201);
    token = res.body.accessToken;
    orgId = res.body.org.id;
    userId = res.body.user.id;

    // sender + 3 leads + 2-step campaign; first step sends now, second in 48h,
    // so after the tick every lead is still active and mid-sequence.
    await http()
      .post('/senders')
      .set('Authorization', auth())
      .send({ provider: 'smtp', fromName: 'Rep', fromEmail: 'rep@ib.local' })
      .expect(201);
    for (const [email, firstName] of [
      ['amy@ib.local', 'Amy'],
      ['oof@ib.local', 'Otto'],
      ['nope@ib.local', 'Nina'],
    ]) {
      await http()
        .post('/leads')
        .set('Authorization', auth())
        .send({ email, firstName })
        .expect(201);
    }
    const tpls = await http().get('/templates').set('Authorization', auth());
    const camp = await http()
      .post('/campaigns')
      .set('Authorization', auth())
      .send({ name: 'Inbox test' })
      .expect(201);
    campaignId = camp.body.id;
    for (const delayHours of [0, 48]) {
      await http()
        .post(`/campaigns/${campaignId}/steps`)
        .set('Authorization', auth())
        .send({ templateId: tpls.body[0].id, delayHours })
        .expect(201);
    }
    await http()
      .post(`/campaigns/${campaignId}/enroll`)
      .set('Authorization', auth())
      .expect(200);
    const tick = await http()
      .post('/sending/tick')
      .set('Authorization', auth())
      .expect(200);
    expect(tick.body.sent).toBe(3);
  });

  afterAll(async () => {
    await withOrgContext(pool, orgId, async (c) => {
      await c.query(`DELETE FROM orgs WHERE id = $1`, [orgId]);
    });
    await pool.query(`DELETE FROM users WHERE id = $1`, [userId]);
    await app.close();
  });

  it('threads a reply, classifies it (mock AI) and stops the sequence', async () => {
    expect((await enrollmentOf('amy@ib.local')).status).toBe('active');

    const r = await http()
      .post('/inbox/simulate-reply')
      .set('Authorization', auth())
      .send({
        fromEmail: 'amy@ib.local',
        subject: 'Re: hi',
        body: 'Sounds good, call me.',
      })
      .expect(201);
    conversationId = r.body.conversationId;
    // the deterministic mock provider picks the first class
    expect(r.body.classification).toBe('interested');
    expect(r.body.action).toBe('stopped');

    const e = await enrollmentOf('amy@ib.local');
    expect(e.status).toBe('stopped');
    expect(e.stop_reason).toBe('replied');

    // the reply event feeds analytics
    const ov = await http()
      .get('/analytics/overview')
      .set('Authorization', auth());
    expect(ov.body.engagement.replied).toBe(1);
  });

  it('a second reply from the same lead lands in the same conversation', async () => {
    const r = await http()
      .post('/inbox/simulate-reply')
      .set('Authorization', auth())
      .send({ fromEmail: 'amy@ib.local', body: 'Also, Tuesday works.' })
      .expect(201);
    expect(r.body.conversationId).toBe(conversationId);
    expect(r.body.action).toBe('none'); // already stopped
  });

  it('out-of-office reschedules instead of stopping', async () => {
    const before = await enrollmentOf('oof@ib.local');
    const r = await http()
      .post('/inbox/simulate-reply')
      .set('Authorization', auth())
      .send({
        fromEmail: 'oof@ib.local',
        body: 'I am away until Monday.',
        classification: 'out_of_office',
      })
      .expect(201);
    expect(r.body.action).toBe('rescheduled');
    const after = await enrollmentOf('oof@ib.local');
    expect(after.status).toBe('active');
    // pushed ~3 days out, later than the original +48h step
    expect(new Date(after.next_send_at!).getTime()).toBeGreaterThan(
      new Date(before.next_send_at!).getTime(),
    );
  });

  it('not-interested stops and tags the lead', async () => {
    const r = await http()
      .post('/inbox/simulate-reply')
      .set('Authorization', auth())
      .send({
        fromEmail: 'nope@ib.local',
        body: 'Not for us, thanks.',
        classification: 'not_interested',
      })
      .expect(201);
    expect(r.body.action).toBe('stopped');
    await withOrgContext(pool, orgId, async (c) => {
      const t = await c.query(
        `SELECT t.name FROM lead_tags lt
         JOIN tags t ON t.id = lt.tag_id
         JOIN leads l ON l.id = lt.lead_id
         WHERE l.email = 'nope@ib.local'`,
      );
      expect(t.rows.map((x: { name: string }) => x.name)).toContain(
        'Not interested',
      );
    });
  });

  it('rejects replies from unknown senders', async () => {
    await http()
      .post('/inbox/simulate-reply')
      .set('Authorization', auth())
      .send({ fromEmail: 'stranger@nowhere.local', body: 'hello' })
      .expect(404);
  });

  it('lists, filters, opens a thread and tracks read state', async () => {
    const all = await http()
      .get('/inbox')
      .set('Authorization', auth())
      .expect(200);
    expect(all.body).toHaveLength(3);

    const interested = await http()
      .get('/inbox?filter=interested')
      .set('Authorization', auth())
      .expect(200);
    expect(interested.body).toHaveLength(1);
    expect(interested.body[0].lead_email).toBe('amy@ib.local');
    expect(interested.body[0].campaign_name).toBe('Inbox test');

    const search = await http()
      .get('/inbox?q=nina')
      .set('Authorization', auth());
    expect(search.body).toHaveLength(1);

    // T7.4: campaign + date-range filters
    const byCampaign = await http()
      .get(`/inbox?campaignId=${campaignId}`)
      .set('Authorization', auth())
      .expect(200);
    expect(byCampaign.body).toHaveLength(3);
    const noCampaign = await http()
      .get('/inbox?campaignId=none')
      .set('Authorization', auth());
    expect(noCampaign.body).toHaveLength(0);
    const today = new Date().toISOString().slice(0, 10);
    const inRange = await http()
      .get(`/inbox?from=${today}&to=${today}`)
      .set('Authorization', auth());
    expect(inRange.body).toHaveLength(3);
    const future = await http()
      .get('/inbox?from=2999-01-01')
      .set('Authorization', auth());
    expect(future.body).toHaveLength(0);
    await http()
      .get('/inbox?campaignId=nope')
      .set('Authorization', auth())
      .expect(400);
    await http()
      .get('/inbox?from=yesterday-ish')
      .set('Authorization', auth())
      .expect(400);

    const thread = await http()
      .get(`/inbox/${conversationId}`)
      .set('Authorization', auth())
      .expect(200);
    const dirs = thread.body.thread.map(
      (m: { direction: string }) => m.direction,
    );
    expect(dirs[0]).toBe('outbound'); // the campaign email comes first
    expect(dirs.filter((d: string) => d === 'inbound')).toHaveLength(2);
    expect(thread.body.lead.email).toBe('amy@ib.local');
    expect(thread.body.enrollment.status).toBe('stopped');

    let count = await http()
      .get('/inbox/unread-count')
      .set('Authorization', auth());
    expect(count.body.unread).toBe(3);
    await http()
      .patch(`/inbox/${conversationId}`)
      .set('Authorization', auth())
      .send({ unread: false, status: 'closed' })
      .expect(200);
    count = await http()
      .get('/inbox/unread-count')
      .set('Authorization', auth());
    expect(count.body.unread).toBe(2);

    const reclass = await http()
      .patch(`/inbox/${conversationId}`)
      .set('Authorization', auth())
      .send({ classification: 'question' })
      .expect(200);
    expect(reclass.body.classification).toBe('question');
    expect(reclass.body.confidence).toBe(1);
  });

  it('replies advance lead status and notify the team', async () => {
    await withOrgContext(pool, orgId, async (c) => {
      const r = await c.query(
        `SELECT email, status FROM leads WHERE email IN ('amy@ib.local','nope@ib.local','oof@ib.local')`,
      );
      const by = Object.fromEntries(
        r.rows.map((x: { email: string; status: string }) => [
          x.email,
          x.status,
        ]),
      );
      expect(by['amy@ib.local']).toBe('interested');
      expect(by['nope@ib.local']).toBe('lost');
      expect(by['oof@ib.local']).toBe('replied');
    });

    const n = await http()
      .get('/notifications')
      .set('Authorization', auth())
      .expect(200);
    // 4 replies ingested (amy x2, oof, nope) -> 4 reply notifications
    expect(
      n.body.filter((x: { type: string }) => x.type === 'reply'),
    ).toHaveLength(4);
    expect(n.body[0].link).toMatch(/^\/inbox\?c=/);

    let count = await http()
      .get('/notifications/unread-count')
      .set('Authorization', auth());
    expect(count.body.unread).toBe(4);
    await http()
      .post(`/notifications/${n.body[0].id}/read`)
      .set('Authorization', auth())
      .expect(200);
    count = await http()
      .get('/notifications/unread-count')
      .set('Authorization', auth());
    expect(count.body.unread).toBe(3);
    await http()
      .post('/notifications/read-all')
      .set('Authorization', auth())
      .expect(200);
    count = await http()
      .get('/notifications/unread-count')
      .set('Authorization', auth());
    expect(count.body.unread).toBe(0);
  });

  it('notes, assignment and conversion', async () => {
    await http()
      .post(`/inbox/${conversationId}/notes`)
      .set('Authorization', auth())
      .send({ body: 'Warm lead — book a call Tuesday.' })
      .expect(201);

    // assign to self (a member) works; a random user id is rejected
    const asg = await http()
      .patch(`/inbox/${conversationId}`)
      .set('Authorization', auth())
      .send({ assignedUserId: userId })
      .expect(200);
    expect(asg.body.assigned_user_id).toBe(userId);
    await http()
      .patch(`/inbox/${conversationId}`)
      .set('Authorization', auth())
      .send({ assignedUserId: randomUUID() })
      .expect(400);

    // convert the out-of-office lead's conversation: still mid-sequence, so
    // conversion must stop it
    const list = await http().get('/inbox?q=otto').set('Authorization', auth());
    const oofConv = list.body[0].id;
    const conv = await http()
      .patch(`/inbox/${oofConv}`)
      .set('Authorization', auth())
      .send({ converted: true })
      .expect(200);
    expect(conv.body.converted_at).toBeTruthy();
    const e = await enrollmentOf('oof@ib.local');
    expect(e.status).toBe('stopped');
    expect(e.stop_reason).toBe('converted');

    const detail = await http()
      .get(`/inbox/${conversationId}`)
      .set('Authorization', auth())
      .expect(200);
    expect(detail.body.notes).toHaveLength(1);
    expect(detail.body.notes[0].author_name).toBe('Ib T');
    expect(detail.body.assigned_user_id).toBe(userId);
    await withOrgContext(pool, orgId, async (c) => {
      const r = await c.query(
        `SELECT status FROM leads WHERE email = 'oof@ib.local'`,
      );
      expect(r.rows[0].status).toBe('converted');
    });
  });

  it('replies to the lead from the inbox, threaded (T7.3)', async () => {
    await http()
      .post(`/inbox/${conversationId}/reply`)
      .set('Authorization', auth())
      .send({ body: '   ' })
      .expect(400);

    const r = await http()
      .post(`/inbox/${conversationId}/reply`)
      .set('Authorization', auth())
      .send({ body: 'Great — Tuesday 3pm?\nI will send an invite.' })
      .expect(201);
    expect(r.body.subject).toMatch(/^Re: /i);

    const msg = [...MockProvider.outbox]
      .reverse()
      .find((m) => m.to === 'amy@ib.local');
    expect(msg?.subject).toBe(r.body.subject);
    expect(msg?.text).toContain('Tuesday 3pm');
    expect(msg?.html).toContain('<br>');

    const thread = await http()
      .get(`/inbox/${conversationId}`)
      .set('Authorization', auth())
      .expect(200);
    const last = thread.body.thread[thread.body.thread.length - 1];
    expect(last.direction).toBe('outbound');
    expect(last.from_email).toBe('rep@ib.local');
    expect(last.body_text).toContain('Tuesday 3pm');
    expect(thread.body.unread).toBe(false);

    await http()
      .post(`/inbox/${randomUUID()}/reply`)
      .set('Authorization', auth())
      .send({ body: 'hi' })
      .expect(404);
  });
});
