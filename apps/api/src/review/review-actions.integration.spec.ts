/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-call */
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'crypto';
import { Pool } from 'pg';
import request from 'supertest';
import { AppModule } from '../app.module';
import { PG_POOL } from '../db/db.module';
import { withOrgContext } from '../db/tenant-context';
import { verifyAllSenders } from '../../test/verify-senders';

jest.setTimeout(120_000);

/**
 * Learning Loop T11: approvals (keep / pause / resume / challenger), with
 * revision checks, idempotency, concurrency, audit, roles, tenant isolation,
 * and what the send path does after a pause.
 */
describe('Review actions: approvals, pause, resume, challenger (T11)', () => {
  let app: INestApplication;
  let pool: Pool;
  let token: string;
  let managerToken: string;
  let agentToken: string;
  let otherToken: string;
  let orgId: string;
  let userId: string;
  let otherOrgId: string;
  let otherUserId: string;
  const extraUsers: string[] = [];
  let templateId: string;

  const http = () => request(app.getHttpServer());
  const as = (t: string) => `Bearer ${t}`;
  const q = <T>(
    fn: (c: Parameters<Parameters<typeof withOrgContext>[2]>[0]) => Promise<T>,
  ) => withOrgContext(pool, orgId, fn);

  // ── builders ────────────────────────────────────────────────────────────

  /** A campaign with a running experiment (A control, B) inserted directly. */
  const mkExp = async () =>
    q(async (c) => {
      const camp = await c.query<{ id: string }>(
        `INSERT INTO campaigns (org_id, name, status) VALUES ($1,'T11 actions','active') RETURNING id`,
        [orgId],
      );
      const st = await c.query<{ id: string }>(
        `INSERT INTO campaign_steps (org_id, campaign_id, step_order, delay_hours)
         VALUES ($1,$2,0,0) RETURNING id`,
        [orgId, camp.rows[0].id],
      );
      const ex = await c.query<{ id: string }>(
        `INSERT INTO experiments (org_id, campaign_id, step_id, status, started_at, created_by)
         VALUES ($1,$2,$3,'running',now(),$4) RETURNING id`,
        [orgId, camp.rows[0].id, st.rows[0].id, userId],
      );
      const ids: string[] = [];
      for (const [i, label] of ['A', 'B'].entries()) {
        const v = await c.query<{ id: string }>(
          `INSERT INTO experiment_variants (org_id, experiment_id, label, subject, is_control, status)
           VALUES ($1,$2,$3,$4,$5,'active') RETURNING id`,
          [orgId, ex.rows[0].id, label, `Subject ${label}`, i === 0],
        );
        ids.push(v.rows[0].id);
      }
      return {
        campaignId: camp.rows[0].id,
        stepId: st.rows[0].id,
        experimentId: ex.rows[0].id,
        a: ids[0],
        b: ids[1],
      };
    });

  type Allowed = { type: string; variantId?: string };
  /** A stored review revision with the actions the policy would have offered. */
  const mkReview = async (
    experimentId: string,
    revision: number,
    allowed: Allowed[],
    winnerVariantId: string | null = null,
  ) =>
    q(async (c) => {
      const reviewId = randomUUID();
      const allowedActions = allowed.map((a) => ({
        actionId: `${a.type}-${a.variantId ?? 'x'}-${reviewId.slice(0, 8)}`,
        type: a.type,
        ...(a.variantId ? { variantId: a.variantId } : {}),
        label: a.type,
      }));
      await c.query(
        `INSERT INTO reviews (id, org_id, experiment_id, revision, policy_version, simulated,
            inputs_hash, inputs, result, explanation)
         VALUES ($1,$2,$3,$4,'v1',false,$5,'{}'::jsonb,$6::jsonb,'{"summary":"x","points":[]}'::jsonb)`,
        [
          reviewId,
          orgId,
          experimentId,
          revision,
          `h-${revision}-${reviewId}`,
          JSON.stringify({
            decision: winnerVariantId ? 'promote' : 'inconclusive',
            winnerVariantId,
            allowedActions,
          }),
        ],
      );
      return { reviewId, actions: allowedActions };
    });

  const approve = (
    t: string,
    reviewId: string,
    actionId: string,
    body: Record<string, unknown>,
  ) =>
    http()
      .post(`/reviews/${reviewId}/actions/${actionId}/approve`)
      .set('Authorization', as(t))
      .send({ idempotencyKey: randomUUID(), ...body });

  const variantStatus = (id: string) =>
    q(
      async (c) =>
        (
          await c.query<{ status: string }>(
            `SELECT status FROM experiment_variants WHERE id = $1`,
            [id],
          )
        ).rows[0].status,
    );

  // ── sending-flow builders (real campaign, real ticks) ───────────────────

  const tick = async () => {
    await http()
      .post('/sending/tick')
      .set('Authorization', as(token))
      .expect(200);
    await http()
      .post('/sending/tick')
      .set('Authorization', as(token))
      .expect(200);
  };

  const mkLead = async (email: string) => {
    const l = await http()
      .post('/leads')
      .set('Authorization', as(token))
      .send({ email, firstName: 'T11' })
      .expect(201);
    return l.body.id as string;
  };

  /** Queue a lead for the campaign's first step, due now (the experiment freezes the audience). */
  const queue = async (campaignId: string, leadId: string) =>
    q((c) =>
      c.query(
        `INSERT INTO campaign_leads (org_id, campaign_id, lead_id, status, current_step, next_send_at)
         VALUES ($1,$2,$3,'active',0, now())`,
        [orgId, campaignId, leadId],
      ),
    );

  const mkCampaign = async (tag: string, companies: number, steps = 1) => {
    const seg = await http()
      .post('/segments')
      .set('Authorization', as(token))
      .send({
        name: `T11Seg-${tag}-${randomUUID().slice(0, 4)}`,
        type: 'manual',
      })
      .expect(201);
    const leadIds: string[] = [];
    for (let i = 0; i < companies; i++) {
      leadIds.push(await mkLead(`first@${tag}-${i}.example.org`));
    }
    await http()
      .post(`/segments/${seg.body.id}/members`)
      .set('Authorization', as(token))
      .send({ leadIds })
      .expect(200);
    const camp = await http()
      .post('/campaigns')
      .set('Authorization', as(token))
      .send({ name: `T11 ${tag}`, segmentId: seg.body.id })
      .expect(201);
    const stepIds: string[] = [];
    for (let s = 0; s < steps; s++) {
      const st = await http()
        .post(`/campaigns/${camp.body.id}/steps`)
        .set('Authorization', as(token))
        .send({ templateId, delayHours: s === 0 ? 0 : 24 })
        .expect(201);
      stepIds.push(st.body.id);
    }
    const exp = await http()
      .post(`/campaigns/${camp.body.id}/experiments`)
      .set('Authorization', as(token))
      .send({
        stepId: stepIds[0],
        variants: [
          { label: 'A', subject: `Alpha ${tag}` },
          { label: 'B', subject: `Bravo ${tag}` },
        ],
      })
      .expect(201);
    await http()
      .post(`/experiments/${exp.body.id}/start`)
      .set('Authorization', as(token))
      .expect(200);
    await http()
      .post(`/campaigns/${camp.body.id}/enroll`)
      .set('Authorization', as(token))
      .expect(200);
    const variants = exp.body.variants as { id: string; label: string }[];
    return {
      campaignId: camp.body.id as string,
      experimentId: exp.body.id as string,
      stepIds,
      a: variants.find((v) => v.label === 'A')!.id,
      b: variants.find((v) => v.label === 'B')!.id,
      tag,
    };
  };

  const sentRows = (campaignId: string, stepId?: string) =>
    q(async (c) => {
      const r = await c.query<{
        subject: string;
        variant_id: string | null;
        experiment_id: string | null;
        company_key: string;
        lead_id: string;
        to_email: string;
      }>(
        `SELECT se.subject, se.variant_id, se.experiment_id, l.company_key, se.lead_id, se.to_email
           FROM sent_emails se JOIN leads l ON l.id = se.lead_id
          WHERE se.campaign_id = $1 AND se.status = 'sent'
            AND ($2::uuid IS NULL OR se.step_id = $2)`,
        [campaignId, stepId ?? null],
      );
      return r.rows;
    });

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
        email: `t11-a-${randomUUID().slice(0, 8)}@test.local`,
        password: 't11-password-123',
        name: 'T11 Admin',
        orgName: 'T11 Org A',
      })
      .expect(201);
    token = a.body.accessToken;
    orgId = a.body.org.id;
    userId = a.body.user.id;
    await q((c) =>
      c.query(`UPDATE orgs SET plan = 'internal' WHERE id = $1`, [orgId]),
    );
    const b = await http()
      .post('/auth/signup')
      .send({
        email: `t11-b-${randomUUID().slice(0, 8)}@test.local`,
        password: 't11-password-123',
        name: 'T11 Other',
        orgName: 'T11 Org B',
      })
      .expect(201);
    otherToken = b.body.accessToken;
    otherOrgId = b.body.org.id;
    otherUserId = b.body.user.id;

    for (const role of ['manager', 'agent'] as const) {
      const inv = await http()
        .post('/orgs/invites')
        .set('Authorization', as(token))
        .send({
          email: `t11-${role}-${randomUUID().slice(0, 8)}@test.local`,
          role,
        })
        .expect(201);
      const reg = await http()
        .post(`/invites/${inv.body.token}/register`)
        .send({ name: `T11 ${role}`, password: 'invitee-pass-123' })
        .expect(201);
      extraUsers.push(reg.body.user.id);
      if (role === 'manager') managerToken = reg.body.accessToken;
      else agentToken = reg.body.accessToken;
    }

    await http()
      .post('/senders')
      .set('Authorization', as(token))
      .send({
        provider: 'smtp',
        fromName: 'T11 Rep',
        fromEmail: 'rep@t11.local',
        dailyLimit: 500,
      })
      .expect(201);
    await verifyAllSenders(app.getHttpServer(), as(token));
    await q((c) =>
      c.query(
        `UPDATE sender_accounts SET warmup_enabled = false, daily_limit = 500`,
      ),
    );
    const tpls = await http()
      .get('/templates')
      .set('Authorization', as(token))
      .expect(200);
    templateId = tpls.body[0].id;
  });

  afterAll(async () => {
    delete process.env.THROTTLE_DISABLED;
    for (const o of [orgId, otherOrgId]) {
      await withOrgContext(pool, o, (c) =>
        c.query(`DELETE FROM orgs WHERE id = $1`, [o]),
      );
    }
    for (const u of [userId, otherUserId, ...extraUsers]) {
      await pool.query(`DELETE FROM users WHERE id = $1`, [u]);
    }
    await app.close();
  });

  // ── approvals ───────────────────────────────────────────────────────────

  it('stale approval (old revision) -> 409 stale_review', async () => {
    const e = await mkExp();
    const r1 = await mkReview(e.experimentId, 1, [{ type: 'keep_testing' }]);
    await mkReview(e.experimentId, 2, [{ type: 'keep_testing' }]);
    const res = await approve(token, r1.reviewId, r1.actions[0].actionId, {
      revision: 1,
    }).expect(409);
    expect(res.body.error).toBe('stale_review');
    // wrong revision number on the newest review is stale too
    const latest = await q(
      async (c) =>
        (
          await c.query<{ id: string }>(
            `SELECT id FROM reviews WHERE experiment_id = $1 AND revision = 2`,
            [e.experimentId],
          )
        ).rows[0].id,
    );
    const r2actions = await q(
      async (c) =>
        (
          await c.query<{ result: { allowedActions: { actionId: string }[] } }>(
            `SELECT result FROM reviews WHERE id = $1`,
            [latest],
          )
        ).rows[0].result.allowedActions,
    );
    await approve(token, latest, r2actions[0].actionId, { revision: 1 }).expect(
      409,
    );
  });

  it('same idempotency key twice -> one row, same response', async () => {
    const e = await mkExp();
    const r = await mkReview(e.experimentId, 1, [
      { type: 'pause_variant', variantId: e.b },
    ]);
    const key = randomUUID();
    const first = await approve(token, r.reviewId, r.actions[0].actionId, {
      revision: 1,
      idempotencyKey: key,
      reason: 'B is behind',
    }).expect(200);
    const second = await approve(token, r.reviewId, r.actions[0].actionId, {
      revision: 1,
      idempotencyKey: key,
      reason: 'B is behind',
    }).expect(200);
    expect(second.body.id).toBe(first.body.id);
    expect(first.body.replayed).toBe(false);
    expect(second.body.replayed).toBe(true);
    const rows = await q((c) =>
      c.query(`SELECT 1 FROM review_actions WHERE idempotency_key = $1`, [key]),
    );
    expect(rows.rowCount).toBe(1);
    // the same key for a different action is refused, not replayed
    const other = await mkReview(e.experimentId, 2, [{ type: 'keep_testing' }]);
    const reused = await approve(
      token,
      other.reviewId,
      other.actions[0].actionId,
      {
        revision: 2,
        idempotencyKey: key,
      },
    ).expect(409);
    expect(reused.body.error).toBe('idempotency_key_reused');
  });

  it('simultaneous approvals (two parallel requests, different keys) -> exactly one applied', async () => {
    const e = await mkExp();
    const r = await mkReview(e.experimentId, 1, [
      { type: 'pause_variant', variantId: e.b },
    ]);
    const send = () =>
      approve(token, r.reviewId, r.actions[0].actionId, { revision: 1 });
    const [x, y] = await Promise.all([send(), send()]);
    expect([x.status, y.status].sort()).toEqual([200, 409]);
    const loser = x.status === 409 ? x : y;
    expect(loser.body.error).toBe('already_applied');
    const applied = await q((c) =>
      c.query(
        `SELECT 1 FROM review_actions WHERE review_id = $1 AND status = 'applied'`,
        [r.reviewId],
      ),
    );
    expect(applied.rowCount).toBe(1);
    expect(await variantStatus(e.b)).toBe('paused');
  });

  it('two parallel pauses of different versions never leave zero active versions', async () => {
    const e = await mkExp();
    const r = await mkReview(e.experimentId, 1, [
      { type: 'pause_variant', variantId: e.a },
      { type: 'pause_variant', variantId: e.b },
    ]);
    const [x, y] = await Promise.all([
      approve(token, r.reviewId, r.actions[0].actionId, { revision: 1 }),
      approve(token, r.reviewId, r.actions[1].actionId, { revision: 1 }),
    ]);
    expect([x.status, y.status].sort()).toEqual([200, 409]);
    const loser = x.status === 409 ? x : y;
    expect(loser.body.error).toBe('last_active_variant');
    const active = await q(
      async (c) =>
        (
          await c.query<{ n: number }>(
            `SELECT count(*)::int AS n FROM experiment_variants
              WHERE experiment_id = $1 AND status = 'active'`,
            [e.experimentId],
          )
        ).rows[0].n,
    );
    expect(active).toBe(1);
  });

  it('pausing the last active variant -> 409 last_active_variant', async () => {
    const e = await mkExp();
    const r = await mkReview(e.experimentId, 1, [
      { type: 'pause_variant', variantId: e.b },
      { type: 'pause_variant', variantId: e.a },
    ]);
    await approve(token, r.reviewId, r.actions[0].actionId, {
      revision: 1,
    }).expect(200);
    const res = await approve(token, r.reviewId, r.actions[1].actionId, {
      revision: 1,
    }).expect(409);
    expect(res.body.error).toBe('last_active_variant');
    expect(await variantStatus(e.a)).toBe('active');
  });

  it('keep testing records the decision only', async () => {
    const e = await mkExp();
    const r = await mkReview(e.experimentId, 1, [{ type: 'keep_testing' }]);
    const res = await approve(token, r.reviewId, r.actions[0].actionId, {
      revision: 1,
      reason: 'wait for more data',
    }).expect(200);
    expect(res.body.type).toBe('keep_testing');
    expect(res.body.status).toBe('applied');
    expect(res.body.reason).toBe('wait for more data');
    expect(await variantStatus(e.a)).toBe('active');
    expect(await variantStatus(e.b)).toBe('active');
  });

  it('pause + resume + undo: audit rows carry who, when, before and after', async () => {
    const e = await mkExp();
    const r = await mkReview(e.experimentId, 1, [
      { type: 'pause_variant', variantId: e.b },
    ]);
    const paused = await approve(
      managerToken,
      r.reviewId,
      r.actions[0].actionId,
      {
        revision: 1,
        reason: 'B is clearly behind',
      },
    ).expect(200);
    expect(paused.body.before.status).toBe('active');
    expect(paused.body.after.status).toBe('paused');
    expect(paused.body.after.reason).toBe('B is clearly behind');
    expect(paused.body.requestedBy.name).toBe('T11 manager');
    expect(paused.body.approvedBy.name).toBe('T11 manager');
    expect(paused.body.appliedAt).toBeTruthy();
    expect(paused.body.canRevert).toBe(true);
    const row = await q(
      async (c) =>
        (
          await c.query(
            `SELECT paused_by, paused_at, pause_reason FROM experiment_variants WHERE id = $1`,
            [e.b],
          )
        ).rows[0],
    );
    expect(row.pause_reason).toBe('B is clearly behind');
    expect(row.paused_at).toBeTruthy();

    // resume (a wrong revision first -> 409)
    await http()
      .post(`/experiments/${e.experimentId}/variants/${e.b}/resume`)
      .set('Authorization', as(token))
      .send({ revision: 9, idempotencyKey: randomUUID() })
      .expect(409);
    const resumed = await http()
      .post(`/experiments/${e.experimentId}/variants/${e.b}/resume`)
      .set('Authorization', as(token))
      .send({ revision: 1, idempotencyKey: randomUUID() })
      .expect(200);
    expect(resumed.body.type).toBe('resume_variant');
    expect(resumed.body.before.status).toBe('paused');
    expect(resumed.body.after.status).toBe('active');
    expect(await variantStatus(e.b)).toBe('active');
    // resuming something that is not paused is refused
    await http()
      .post(`/experiments/${e.experimentId}/variants/${e.b}/resume`)
      .set('Authorization', as(token))
      .send({ revision: 1, idempotencyKey: randomUUID() })
      .expect(409);

    // the same review can pause B again now that the first pause was undone
    const again = await approve(token, r.reviewId, r.actions[0].actionId, {
      revision: 1,
    }).expect(200);
    expect(await variantStatus(e.b)).toBe('paused');

    // undo the pause through the revert endpoint
    const reverted = await http()
      .post(`/review-actions/${again.body.id}/revert`)
      .set('Authorization', as(token))
      .send({ idempotencyKey: randomUUID(), reason: 'changed my mind' })
      .expect(200);
    expect(reverted.body.type).toBe('resume_variant');
    expect(reverted.body.revertsActionId).toBe(again.body.id);
    expect(await variantStatus(e.b)).toBe('active');
    await http()
      .post(`/review-actions/${again.body.id}/revert`)
      .set('Authorization', as(token))
      .send({ idempotencyKey: randomUUID(), reason: 'twice' })
      .expect(409);

    // history: newest first, readable by an agent, with names
    const hist = await http()
      .get(`/campaigns/${e.campaignId}/review/actions`)
      .set('Authorization', as(agentToken))
      .expect(200);
    expect(hist.body.length).toBeGreaterThanOrEqual(4);
    expect(hist.body[0].type).toBe('resume_variant');
    expect(
      hist.body.every(
        (h: { before: unknown; after: unknown }) => h.before && h.after,
      ),
    ).toBe(true);
  });

  it('keep testing cannot be reverted', async () => {
    const e = await mkExp();
    const r = await mkReview(e.experimentId, 1, [{ type: 'keep_testing' }]);
    const done = await approve(token, r.reviewId, r.actions[0].actionId, {
      revision: 1,
    }).expect(200);
    const res = await http()
      .post(`/review-actions/${done.body.id}/revert`)
      .set('Authorization', as(token))
      .send({ idempotencyKey: randomUUID(), reason: 'no' })
      .expect(400);
    expect(res.body.error).toBe('not_revertible');
  });

  it('simulated review -> 400 simulated_review', async () => {
    const sim = await http()
      .post('/review/simulate')
      .set('Authorization', as(token))
      .send({ scenario: 'valid_winner' })
      .expect(200);
    const id = sim.body.id as string;
    const action = sim.body.result.allowedActions[0]?.actionId ?? 'x';
    const res = await approve(token, id, action, { revision: 1 }).expect(400);
    expect(res.body.error).toBe('simulated_review');
    await http()
      .post(`/reviews/${id}/challenger-drafts`)
      .set('Authorization', as(token))
      .expect(400);
  });

  it('an action the review did not offer -> 400', async () => {
    const e = await mkExp();
    const r = await mkReview(e.experimentId, 1, [{ type: 'keep_testing' }]);
    const res = await approve(token, r.reviewId, 'made-up-action', {
      revision: 1,
    }).expect(400);
    expect(res.body.error).toBe('action_not_allowed');
  });

  it('agent cannot approve, resume, revert or draft (403); other workspace gets 404', async () => {
    const e = await mkExp();
    const r = await mkReview(e.experimentId, 1, [
      { type: 'pause_variant', variantId: e.b },
      { type: 'draft_challenger' },
    ]);
    await approve(agentToken, r.reviewId, r.actions[0].actionId, {
      revision: 1,
    }).expect(403);
    await http()
      .post(`/experiments/${e.experimentId}/variants/${e.b}/resume`)
      .set('Authorization', as(agentToken))
      .send({ revision: 1, idempotencyKey: randomUUID() })
      .expect(403);
    await http()
      .post(`/review-actions/${randomUUID()}/revert`)
      .set('Authorization', as(agentToken))
      .send({ idempotencyKey: randomUUID(), reason: 'x' })
      .expect(403);
    await http()
      .post(`/reviews/${r.reviewId}/challenger-drafts`)
      .set('Authorization', as(agentToken))
      .expect(403);
    expect(await variantStatus(e.b)).toBe('active');

    // another workspace cannot see any of it
    await approve(otherToken, r.reviewId, r.actions[0].actionId, {
      revision: 1,
    }).expect(404);
    await http()
      .get(`/campaigns/${e.campaignId}/review/actions`)
      .set('Authorization', as(otherToken))
      .expect(404);
    await http()
      .post(`/experiments/${e.experimentId}/variants/${e.b}/resume`)
      .set('Authorization', as(otherToken))
      .send({ revision: 1, idempotencyKey: randomUUID() })
      .expect(404);
    await http()
      .post(`/reviews/${r.reviewId}/challenger-drafts`)
      .set('Authorization', as(otherToken))
      .expect(404);
  });

  // ── challenger ──────────────────────────────────────────────────────────

  it('approve challenger: old experiment decided, new one running, linked', async () => {
    const e = await mkExp();
    const keepOnly = await mkReview(e.experimentId, 1, [
      { type: 'keep_testing' },
    ]);
    const r = await mkReview(
      e.experimentId,
      2,
      [{ type: 'draft_challenger' }],
      e.b,
    );
    const noDrafts = await http()
      .post(`/reviews/${keepOnly.reviewId}/challenger-drafts`)
      .set('Authorization', as(token))
      .expect(400);
    expect(noDrafts.body.error).toBe('draft_not_allowed');

    const drafted = await http()
      .post(`/reviews/${r.reviewId}/challenger-drafts`)
      .set('Authorization', as(token))
      .expect(200);
    expect(drafted.body.drafts).toHaveLength(3);
    expect(drafted.body.actionId).toBe(r.actions[0].actionId);
    const subjects = drafted.body.drafts.map(
      (d: { subject: string }) => d.subject,
    );
    expect(new Set(subjects).size).toBe(3);
    expect(subjects).not.toContain('Subject A');
    expect(subjects).not.toContain('Subject B');
    const listed = await http()
      .get(`/reviews/${r.reviewId}/challenger-drafts`)
      .set('Authorization', as(agentToken))
      .expect(200);
    expect(listed.body).toHaveLength(3);

    // no draft picked -> 400; a draft of another review -> 404
    const missing = await approve(token, r.reviewId, r.actions[0].actionId, {
      revision: 2,
    }).expect(400);
    expect(missing.body.error).toBe('draft_required');
    await approve(token, r.reviewId, r.actions[0].actionId, {
      revision: 2,
      draftId: randomUUID(),
    }).expect(404);

    const pick = drafted.body.drafts[1];
    const ok = await approve(token, r.reviewId, r.actions[0].actionId, {
      revision: 2,
      draftId: pick.id,
    }).expect(200);
    expect(ok.body.type).toBe('approve_challenger');
    const newId = ok.body.after.newExperimentId as string;

    await q(async (c) => {
      const old = await c.query(
        `SELECT status, decision, decided_at FROM experiments WHERE id = $1`,
        [e.experimentId],
      );
      expect(old.rows[0].status).toBe('decided');
      expect(old.rows[0].decision.keptVariantId).toBe(e.b);
      expect(old.rows[0].decided_at).toBeTruthy();
      const nu = await c.query(
        `SELECT status, previous_experiment_id, step_id, campaign_id, baseline_rate, min_lift_pp
           FROM experiments WHERE id = $1`,
        [newId],
      );
      expect(nu.rows[0].status).toBe('running');
      expect(nu.rows[0].previous_experiment_id).toBe(e.experimentId);
      expect(nu.rows[0].step_id).toBe(e.stepId);
      expect(nu.rows[0].min_lift_pp).toBe(2);
      const vs = await c.query(
        `SELECT label, subject, is_control, status FROM experiment_variants
          WHERE experiment_id = $1 ORDER BY label`,
        [newId],
      );
      expect(vs.rows).toEqual([
        {
          label: 'A',
          subject: 'Subject B',
          is_control: true,
          status: 'active',
        },
        {
          label: 'B',
          subject: pick.subject,
          is_control: false,
          status: 'active',
        },
      ]);
    });

    // a second approval of the same action is refused, and the campaign's
    // Review now follows the new test
    await approve(token, r.reviewId, r.actions[0].actionId, {
      revision: 2,
      draftId: pick.id,
    }).expect(409);
    const camp = await http()
      .get(`/campaigns/${e.campaignId}/review`)
      .set('Authorization', as(token))
      .expect(200);
    expect(camp.body.experimentId).toBe(newId);
  });

  // ── the send path after a pause ────────────────────────────────────────

  it('paused version: new companies get only A; a colleague already on B keeps B; resume allows B again', async () => {
    const m = await mkCampaign('pause', 10);
    await tick();
    const before = await sentRows(m.campaignId);
    expect(before).toHaveLength(10);
    const onB = before.filter((s) => s.variant_id === m.b);
    expect(onB.length).toBeGreaterThan(0);
    expect(onB.length).toBeLessThan(10);

    const r = await mkReview(m.experimentId, 1, [
      { type: 'pause_variant', variantId: m.b },
    ]);
    await approve(token, r.reviewId, r.actions[0].actionId, {
      revision: 1,
      reason: 'test',
    }).expect(200);

    // 8 brand-new companies + a second contact at a company already on B
    const fresh: string[] = [];
    for (let i = 0; i < 8; i++) {
      const id = await mkLead(`new@${m.tag}-fresh-${i}.example.org`);
      fresh.push(id);
      await queue(m.campaignId, id);
    }
    const bDomain = onB[0].company_key;
    const colleague = await mkLead(`second@${bDomain}`);
    await queue(m.campaignId, colleague);
    await tick();

    const after = await sentRows(m.campaignId);
    expect(after).toHaveLength(19);
    // 1. existing history untouched
    for (const old of before) {
      expect(after.find((s) => s.lead_id === old.lead_id)?.variant_id).toBe(
        old.variant_id,
      );
    }
    // 2. every new company got A
    for (const id of fresh) {
      expect(after.find((s) => s.lead_id === id)?.variant_id).toBe(m.a);
    }
    // 3. the colleague of a company already assigned to the paused B keeps B
    const col = after.find((s) => s.lead_id === colleague)!;
    expect(col.variant_id).toBe(m.b);
    expect(col.subject).toBe(onB[0].subject);

    // resume: only future assignments change
    await http()
      .post(`/experiments/${m.experimentId}/variants/${m.b}/resume`)
      .set('Authorization', as(token))
      .send({ revision: 1, idempotencyKey: randomUUID() })
      .expect(200);
    const later: string[] = [];
    for (let i = 0; i < 24; i++) {
      const id = await mkLead(`late@${m.tag}-later-${i}.example.org`);
      later.push(id);
      await queue(m.campaignId, id);
    }
    await tick();
    const final = await sentRows(m.campaignId);
    for (const row of after) {
      expect(final.find((s) => s.lead_id === row.lead_id)?.variant_id).toBe(
        row.variant_id,
      );
    }
    const laterVariants = later.map(
      (id) => final.find((s) => s.lead_id === id)?.variant_id,
    );
    expect(laterVariants).toContain(m.a);
    expect(laterVariants).toContain(m.b);
  });

  it('in-flight follow-ups after a pause still send with the original variant attribution', async () => {
    const m = await mkCampaign('follow', 10, 2);
    await tick();
    const first = await sentRows(m.campaignId, m.stepIds[0]);
    expect(first).toHaveLength(10);
    const b = first.filter((s) => s.variant_id === m.b);
    expect(b.length).toBeGreaterThan(0);

    const r = await mkReview(m.experimentId, 1, [
      { type: 'pause_variant', variantId: m.b },
    ]);
    await approve(token, r.reviewId, r.actions[0].actionId, {
      revision: 1,
    }).expect(200);

    await q((c) =>
      c.query(
        `UPDATE campaign_leads SET next_send_at = now()
          WHERE campaign_id = $1 AND current_step = 1 AND status = 'active'`,
        [m.campaignId],
      ),
    );
    await tick();
    const second = await sentRows(m.campaignId, m.stepIds[1]);
    expect(second).toHaveLength(10);
    for (const f of first) {
      const s = second.find((x) => x.lead_id === f.lead_id)!;
      expect(s.variant_id).toBe(f.variant_id);
      expect(s.experiment_id).toBe(m.experimentId);
    }
  });

  it('dispatch still re-checks campaign status and suppression while a version is paused', async () => {
    const m = await mkCampaign('recheck', 2);
    await tick();
    const r = await mkReview(m.experimentId, 1, [
      { type: 'pause_variant', variantId: m.b },
    ]);
    await approve(token, r.reviewId, r.actions[0].actionId, {
      revision: 1,
    }).expect(200);

    const suppressed = await mkLead(`nope@${m.tag}-sup.example.org`);
    await queue(m.campaignId, suppressed);
    await q((c) =>
      c.query(
        `INSERT INTO suppression_list (org_id, email, reason)
         VALUES ($1, $2, 'unsubscribed')`,
        [orgId, `nope@${m.tag}-sup.example.org`],
      ),
    );
    await tick();
    const st = await q(
      async (c) =>
        (
          await c.query(
            `SELECT status, stop_reason FROM campaign_leads WHERE campaign_id = $1 AND lead_id = $2`,
            [m.campaignId, suppressed],
          )
        ).rows[0],
    );
    expect(st).toEqual({ status: 'stopped', stop_reason: 'suppressed' });

    // campaign paused: a queued first touch is not sent
    const waiting = await mkLead(`wait@${m.tag}-pausedcamp.example.org`);
    await queue(m.campaignId, waiting);
    await q((c) =>
      c.query(`UPDATE campaigns SET status = 'paused' WHERE id = $1`, [
        m.campaignId,
      ]),
    );
    await tick();
    expect(
      (await sentRows(m.campaignId)).find((s) => s.lead_id === waiting),
    ).toBeUndefined();
    await q((c) =>
      c.query(`UPDATE campaigns SET status = 'active' WHERE id = $1`, [
        m.campaignId,
      ]),
    );
  });

  it('approved challenger: new companies join the new test; companies already assigned stay out of it', async () => {
    const m = await mkCampaign('chall', 6);
    await tick();
    const old = await sentRows(m.campaignId);
    expect(old).toHaveLength(6);
    const known = old[0];
    // a second contact at an already-contacted company, still queued
    const colleague = await mkLead(`second@${known.company_key}`);
    await queue(m.campaignId, colleague);

    const r = await mkReview(
      m.experimentId,
      1,
      [{ type: 'draft_challenger' }],
      m.a,
    );
    const drafted = await http()
      .post(`/reviews/${r.reviewId}/challenger-drafts`)
      .set('Authorization', as(token))
      .expect(200);
    const ok = await approve(token, r.reviewId, r.actions[0].actionId, {
      revision: 1,
      draftId: drafted.body.drafts[0].id,
    }).expect(200);
    const newId = ok.body.after.newExperimentId as string;

    const fresh: string[] = [];
    for (let i = 0; i < 6; i++) {
      const id = await mkLead(`new@${m.tag}-nu-${i}.example.org`);
      fresh.push(id);
      await queue(m.campaignId, id);
    }
    await tick();
    const all = await sentRows(m.campaignId);
    // the colleague is credited to the OLD test and keeps the company's version
    const col = all.find((s) => s.lead_id === colleague)!;
    expect(col.experiment_id).toBe(m.experimentId);
    expect(col.variant_id).toBe(known.variant_id);
    expect(col.subject).toBe(known.subject);
    // brand-new companies belong to the new test
    for (const id of fresh) {
      expect(all.find((s) => s.lead_id === id)?.experiment_id).toBe(newId);
    }
    // the old company has no assignment in the new test
    const inNew = await q((c) =>
      c.query(
        `SELECT 1 FROM experiment_assignments WHERE experiment_id = $1 AND company_key = $2`,
        [newId, known.company_key],
      ),
    );
    expect(inNew.rowCount).toBe(0);
    const newAssignments = await q((c) =>
      c.query(`SELECT 1 FROM experiment_assignments WHERE experiment_id = $1`, [
        newId,
      ]),
    );
    expect(newAssignments.rowCount).toBe(6);
  });
});
