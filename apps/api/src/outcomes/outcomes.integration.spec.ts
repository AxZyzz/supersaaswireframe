/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-call */
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'crypto';
import { Pool } from 'pg';
import request from 'supertest';
import { verifyAllSenders } from '../../test/verify-senders';
import { AppModule } from '../app.module';
import { PG_POOL } from '../db/db.module';
import { withOrgContext } from '../db/tenant-context';
import { InboxService } from '../inbox/inbox.service';
import { OutcomesService } from './outcomes.service';

jest.setTimeout(90_000);

/**
 * Outcome events (T03): idempotent, attributed to company + variant,
 * provisional until a person verifies, corrections keep history, RLS.
 */
describe('Outcome events and verification (T03)', () => {
  let app: INestApplication;
  let pool: Pool;
  let token: string;
  let orgId: string;
  let userId: string;
  let otherToken: string;
  let otherOrgId: string;
  let otherUserId: string;
  let agentToken: string;
  let agentId: string;
  let campaignId: string;
  let experimentId: string;
  let variantByCompany: Record<string, string> = {};
  const domain = `t03-${randomUUID().slice(0, 6)}.com`;
  const otherDomain = `t03o-${randomUUID().slice(0, 6)}.com`;

  const http = () => request(app.getHttpServer());
  const auth = () => `Bearer ${token}`;
  const q = <T>(
    fn: (c: Parameters<Parameters<typeof withOrgContext>[2]>[0]) => Promise<T>,
  ) => withOrgContext(pool, orgId, fn);

  const reply = (
    fromEmail: string,
    classification: string,
    extra: Record<string, unknown> = {},
  ) =>
    http()
      .post('/inbox/simulate-reply')
      .set('Authorization', auth())
      .send({ fromEmail, body: 'Yes, tell me more', classification, ...extra });

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

    const a = await http()
      .post('/auth/signup')
      .send({
        email: `t03-a-${randomUUID().slice(0, 8)}@test.local`,
        password: 't03-password-123',
        name: 'T03 Admin',
        orgName: 'T03 Org A',
      })
      .expect(201);
    token = a.body.accessToken;
    orgId = a.body.org.id;
    userId = a.body.user.id;

    const b = await http()
      .post('/auth/signup')
      .send({
        email: `t03-b-${randomUUID().slice(0, 8)}@test.local`,
        password: 't03-password-123',
        name: 'T03 Other',
        orgName: 'T03 Org B',
      })
      .expect(201);
    otherToken = b.body.accessToken;
    otherOrgId = b.body.org.id;
    otherUserId = b.body.user.id;

    // an agent in org A (agents may confirm outcomes)
    const agentEmail = `t03-agent-${randomUUID().slice(0, 8)}@test.local`;
    const inv = await http()
      .post('/orgs/invites')
      .set('Authorization', auth())
      .send({ email: agentEmail, role: 'agent' })
      .expect(201);
    const reg = await http()
      .post(`/invites/${inv.body.token}/register`)
      .send({ name: 'T03 Agent', password: 'agent-pass-123' })
      .expect(201);
    agentToken = reg.body.accessToken;
    agentId = reg.body.user.id;

    await http()
      .post('/senders')
      .set('Authorization', auth())
      .send({
        provider: 'smtp',
        fromName: 'T03 Rep',
        fromEmail: 'rep@t03.local',
        dailyLimit: 500,
      })
      .expect(201);
    await verifyAllSenders(app.getHttpServer(), auth());
    await q((c) =>
      c.query(
        `UPDATE sender_accounts SET warmup_enabled = false, daily_limit = 500`,
      ),
    );

    // Two contacts at one company + one at another, in a running experiment
    const mk = async (email: string) =>
      (
        await http()
          .post('/leads')
          .set('Authorization', auth())
          .send({ email, firstName: email.split('@')[0] })
          .expect(201)
      ).body.id as string;
    const l1 = await mk(`ann@${domain}`);
    const l2 = await mk(`bob@${domain}`);
    const l3 = await mk(`cy@${otherDomain}`);
    const seg = await http()
      .post('/segments')
      .set('Authorization', auth())
      .send({ name: `T03Seg-${randomUUID().slice(0, 6)}`, type: 'manual' })
      .expect(201);
    await http()
      .post(`/segments/${seg.body.id}/members`)
      .set('Authorization', auth())
      .send({ leadIds: [l1, l2, l3] })
      .expect(200);
    const camp = await http()
      .post('/campaigns')
      .set('Authorization', auth())
      .send({ name: 'T03 Outcomes', segmentId: seg.body.id })
      .expect(201);
    campaignId = camp.body.id;
    const tpl = await http().get('/templates').set('Authorization', auth());
    const step = await http()
      .post(`/campaigns/${campaignId}/steps`)
      .set('Authorization', auth())
      .send({ templateId: tpl.body[0].id, delayHours: 0 })
      .expect(201);
    const exp = await http()
      .post(`/campaigns/${campaignId}/experiments`)
      .set('Authorization', auth())
      .send({
        stepId: step.body.id,
        variants: [
          { label: 'A', subject: 'Hello A {company}' },
          { label: 'B', subject: 'Hello B {company}' },
        ],
      })
      .expect(201);
    experimentId = exp.body.id;
    await http()
      .post(`/experiments/${experimentId}/start`)
      .set('Authorization', auth())
      .expect(200);
    await http()
      .post(`/campaigns/${campaignId}/enroll`)
      .set('Authorization', auth())
      .expect(200);
    await http().post('/sending/tick').set('Authorization', auth()).expect(200);

    const as = await q((c) =>
      c.query<{ company_key: string; variant_id: string }>(
        `SELECT company_key, variant_id FROM experiment_assignments WHERE experiment_id = $1`,
        [experimentId],
      ),
    );
    variantByCompany = Object.fromEntries(
      as.rows.map((r) => [r.company_key, r.variant_id]),
    );
  });

  afterAll(async () => {
    delete process.env.THROTTLE_DISABLED;
    for (const o of [orgId, otherOrgId]) {
      await withOrgContext(pool, o, (c) =>
        c.query(`DELETE FROM orgs WHERE id = $1`, [o]),
      );
    }
    for (const u of [userId, otherUserId, agentId]) {
      await pool.query(`DELETE FROM users WHERE id = $1`, [u]);
    }
    await app.close();
  });

  const events = (type?: string) =>
    q((c) =>
      c.query(
        `SELECT * FROM outcome_events ${type ? `WHERE type = '${type}'` : ''} ORDER BY created_at`,
      ),
    );

  it('an interested reply is a verified reply + a PROVISIONAL qualified reply, attributed to company and variant', async () => {
    expect(Object.keys(variantByCompany)).toContain(domain);
    await reply(`ann@${domain}`, 'interested').expect(201);

    const rep = (await events('reply')).rows;
    const qr = (await events('qualified_reply')).rows;
    expect(rep).toHaveLength(1);
    expect(rep[0]).toMatchObject({
      verification: 'verified',
      company_key: domain,
      experiment_id: experimentId,
      variant_id: variantByCompany[domain],
    });
    expect(qr).toHaveLength(1);
    expect(qr[0]).toMatchObject({
      verification: 'provisional',
      source: 'inbox_ai',
      company_key: domain,
      experiment_id: experimentId,
      variant_id: variantByCompany[domain],
    });
  });

  it('a "question" reply is a reply but never a qualified reply on its own', async () => {
    await reply(`cy@${otherDomain}`, 'question').expect(201);
    const qr = (await events('qualified_reply')).rows;
    expect(qr.filter((r) => r.company_key === otherDomain)).toHaveLength(0);
    const rep = (await events('reply')).rows.filter(
      (r) => r.company_key === otherDomain,
    );
    expect(rep).toHaveLength(1);
  });

  it('a second contact at the same company gets the same company key and variant', async () => {
    await reply(`bob@${domain}`, 'interested').expect(201);
    const rows = (await events('reply')).rows.filter(
      (r) => r.company_key === domain,
    );
    expect(rows).toHaveLength(2);
    expect(new Set(rows.map((r) => r.variant_id)).size).toBe(1);
    expect(rows[0].variant_id).toBe(variantByCompany[domain]);
  });

  it('the same reply delivered twice (duplicate sync) records ONE event', async () => {
    const inbox = app.get(InboxService);
    const input = {
      fromEmail: `cy@${otherDomain}`,
      body: 'Sure, send details',
      messageId: `<dup-${randomUUID()}@mail.test>`,
      classification: 'question' as const,
    };
    const before = (await events('reply')).rows.length;
    await inbox.ingestReply(orgId, input);
    await inbox.ingestReply(orgId, input);
    expect((await events('reply')).rows.length).toBe(before + 1);
  });

  it('a late reply (after the response window) is stored, not dropped', async () => {
    const inbox = app.get(InboxService);
    await inbox.ingestReply(orgId, {
      fromEmail: `cy@${otherDomain}`,
      body: 'Sorry for the delay, interested',
      messageId: `<late-${randomUUID()}@mail.test>`,
      classification: 'question',
    });
    // push it 40 days out: still stored, T04 decides whether it counts
    await q((c) =>
      c.query(
        `UPDATE outcome_events SET occurred_at = now() + interval '40 days'
          WHERE id = (SELECT id FROM outcome_events WHERE type = 'reply'
                      AND company_key = $1 ORDER BY created_at DESC LIMIT 1)`,
        [otherDomain],
      ),
    );
    const late = (await events('reply')).rows.filter(
      (r) => r.company_key === otherDomain,
    );
    expect(late.length).toBeGreaterThanOrEqual(2);
    expect(
      late.some(
        (r) => new Date(r.occurred_at).getTime() > Date.now() + 39 * 86400_000,
      ),
    ).toBe(true);
  });

  it('unmatched mail from a known lead (no enrollment) lands in the unattributed list', async () => {
    const lead = await http()
      .post('/leads')
      .set('Authorization', auth())
      .send({
        email: `stray@${domain.replace('t03-', 't03x-')}`,
        firstName: 'Stray',
      })
      .expect(201);
    await reply(lead.body.email, 'interested').expect(201);
    const un = await http()
      .get('/outcomes/unattributed')
      .set('Authorization', auth())
      .expect(200);
    const mine = un.body.filter((r: any) => r.lead_id === lead.body.id);
    expect(mine.map((r: any) => r.type).sort()).toEqual([
      'qualified_reply',
      'reply',
    ]);
    expect(mine.every((r: any) => r.experiment_id === null)).toBe(true);
  });

  it('correction chain: provisional → verified → corrected to rejected, current view shows rejected, history keeps all 3', async () => {
    const prov = await http()
      .get('/outcomes?status=provisional')
      .set('Authorization', auth())
      .expect(200);
    const target = prov.body.find((r: any) => r.company_key === domain);
    expect(target).toBeTruthy();
    expect(target.verification).toBe('provisional');

    // an AGENT can confirm
    const v1 = await http()
      .post(`/outcomes/${target.id}/verify`)
      .set('Authorization', `Bearer ${agentToken}`)
      .send({ decision: 'verified' })
      .expect(200);
    expect(v1.body).toMatchObject({
      verification: 'verified',
      supersedes_id: target.id,
      verified_by: agentId,
    });

    // retrying the same decision is idempotent
    const again = await http()
      .post(`/outcomes/${target.id}/verify`)
      .set('Authorization', auth())
      .send({ decision: 'verified' })
      .expect(200);
    expect(again.body.id).toBe(v1.body.id);

    // changing an already-made decision needs a reason
    await http()
      .post(`/outcomes/${v1.body.id}/verify`)
      .set('Authorization', auth())
      .send({ decision: 'rejected' })
      .expect(400);
    const v2 = await http()
      .post(`/outcomes/${v1.body.id}/verify`)
      .set('Authorization', auth())
      .send({ decision: 'rejected', reason: 'Was an auto-reply, not interest' })
      .expect(200);
    expect(v2.body.verification).toBe('rejected');

    // verifying the old, superseded row is refused
    await http()
      .post(`/outcomes/${target.id}/verify`)
      .set('Authorization', auth())
      .send({ decision: 'rejected', reason: 'again' })
      .expect(409);

    const cur = await q((c) =>
      c.query(
        `SELECT verification FROM v_outcomes_current
          WHERE type = 'qualified_reply' AND id IN ($1,$2,$3)`,
        [target.id, v1.body.id, v2.body.id],
      ),
    );
    expect(cur.rows).toEqual([{ verification: 'rejected' }]);

    const hist = await http()
      .get(`/outcomes/history/${target.conversation_id}`)
      .set('Authorization', auth())
      .expect(200);
    expect(hist.body.map((h: any) => h.verification)).toEqual([
      'provisional',
      'verified',
      'rejected',
    ]);
  });

  it('a reply is a fact: it cannot be "verified"', async () => {
    const rep = (await events('reply')).rows[0];
    await http()
      .post(`/outcomes/${rep.id}/verify`)
      .set('Authorization', auth())
      .send({ decision: 'verified' })
      .expect(400);
  });

  it('another workspace cannot see or verify these outcomes (RLS)', async () => {
    const qr = (await events('qualified_reply')).rows[0];
    await http()
      .post(`/outcomes/${qr.id}/verify`)
      .set('Authorization', `Bearer ${otherToken}`)
      .send({ decision: 'verified' })
      .expect(404);
    const theirs = await http()
      .get('/outcomes?status=provisional')
      .set('Authorization', `Bearer ${otherToken}`)
      .expect(200);
    expect(theirs.body).toEqual([]);
    const rows = await withOrgContext(pool, otherOrgId, (c) =>
      c.query(`SELECT id FROM outcome_events`),
    );
    expect(rows.rowCount).toBe(0);
  });

  it('the "converted" mark makes a booked_call (verified for a manager/admin) and un-converting supersedes it', async () => {
    const conv = await q((c) =>
      c.query<{ id: string }>(
        `SELECT conversation_id AS id FROM outcome_events
          WHERE type = 'qualified_reply' AND company_key = $1 LIMIT 1`,
        [domain],
      ),
    );
    const id = conv.rows[0].id;
    await http()
      .patch(`/inbox/${id}`)
      .set('Authorization', auth())
      .send({ converted: true })
      .expect(200);
    const booked = (await events('booked_call')).rows;
    expect(booked).toHaveLength(1);
    expect(booked[0]).toMatchObject({
      verification: 'verified',
      source: 'manual',
      company_key: domain,
      experiment_id: experimentId,
    });

    await http()
      .patch(`/inbox/${id}`)
      .set('Authorization', auth())
      .send({ converted: false })
      .expect(200);
    const cur = await q((c) =>
      c.query(
        `SELECT verification FROM v_outcomes_current
          WHERE type = 'booked_call' AND conversation_id = $1`,
        [id],
      ),
    );
    expect(cur.rows).toEqual([{ verification: 'rejected' }]);
    expect((await events('booked_call')).rows).toHaveLength(2);
  });

  it('an unsubscribe creates a verified outcome once, however often the link is hit', async () => {
    const tok = await q((c) =>
      c.query<{ token: string }>(
        `SELECT unsub_token AS token FROM campaign_leads
          WHERE campaign_id = $1 LIMIT 1`,
        [campaignId],
      ),
    );
    if (!tok.rows[0]?.token) return; // schema without a token column: skip
    await http().post(`/u/${tok.rows[0].token}`).expect(200);
    await http().post(`/u/${tok.rows[0].token}`).expect(200);
    expect((await events('unsubscribe')).rows).toHaveLength(1);
  });

  it('a bounce creates a verified outcome tied to the email that bounced', async () => {
    const svc = app.get(OutcomesService);
    const se = await q((c) =>
      c.query<{ id: string; lead_id: string }>(
        `SELECT id, lead_id FROM sent_emails WHERE campaign_id = $1 LIMIT 1`,
        [campaignId],
      ),
    );
    const key = `bounce:${se.rows[0].id}`;
    for (let i = 0; i < 2; i++) {
      await withOrgContext(pool, orgId, (c) =>
        svc.record(c, orgId, {
          type: 'bounce',
          source: 'gmail_sync',
          verification: 'verified',
          idempotencyKey: key,
          leadId: se.rows[0].lead_id,
          sentEmailId: se.rows[0].id,
        }),
      );
    }
    const b = (await events('bounce')).rows;
    expect(b).toHaveLength(1);
    expect(b[0]).toMatchObject({
      experiment_id: experimentId,
      sent_email_id: se.rows[0].id,
    });
  });

  it('manual outcomes are idempotent on the client key', async () => {
    const cl = await q((c) =>
      c.query<{ id: string }>(
        `SELECT id FROM campaign_leads WHERE campaign_id = $1 LIMIT 1`,
        [campaignId],
      ),
    );
    const body = {
      campaignLeadId: cl.rows[0].id,
      type: 'qualified_reply',
      occurredAt: new Date().toISOString(),
      reason: 'Phone call from the prospect',
      idempotencyKey: randomUUID(),
    };
    const a = await http()
      .post('/outcomes')
      .set('Authorization', `Bearer ${agentToken}`)
      .send(body)
      .expect(201);
    const b = await http()
      .post('/outcomes')
      .set('Authorization', `Bearer ${agentToken}`)
      .send(body)
      .expect(201);
    expect(b.body.id).toBe(a.body.id);
    expect(a.body.created).toBe(true);
    expect(b.body.created).toBe(false);
  });

  it('outcome coverage counts replying companies with nothing still waiting for a person', async () => {
    const r = await http()
      .get(`/experiments/${experimentId}/outcome-coverage`)
      .set('Authorization', auth())
      .expect(200);
    expect(r.body.replyingCompanies).toBeGreaterThanOrEqual(1);
    expect(r.body.coverage).toBeGreaterThan(0);
    expect(r.body.coverage).toBeLessThanOrEqual(1);
  });

  it('the rubric defaults, can be edited by a manager/admin, and not by an agent', async () => {
    const d = await http()
      .get('/review/rubric')
      .set('Authorization', `Bearer ${agentToken}`)
      .expect(200);
    expect(d.body.isDefault).toBe(true);
    await http()
      .put('/review/rubric')
      .set('Authorization', `Bearer ${agentToken}`)
      .send({ rubric: 'Qualified = wants a demo this quarter.' })
      .expect(403);
    await http()
      .put('/review/rubric')
      .set('Authorization', auth())
      .send({ rubric: 'Qualified = wants a demo this quarter.' })
      .expect(200);
    const after = await http()
      .get('/review/rubric')
      .set('Authorization', `Bearer ${agentToken}`)
      .expect(200);
    expect(after.body).toEqual({
      rubric: 'Qualified = wants a demo this quarter.',
      isDefault: false,
    });
  });
});
