/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-call */
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'crypto';
import { Pool } from 'pg';
import request from 'supertest';
import { AppModule } from '../app.module';
import { PG_POOL } from '../db/db.module';
import { withOrgContext } from '../db/tenant-context';
import { ReviewService } from './review.service';
import { SCENARIOS } from './simulation';

jest.setTimeout(90_000);

/**
 * Review (T05): company-level aggregation, revisions, simulation isolation,
 * roles and tenant isolation.
 */
describe('Review API and aggregation (T05)', () => {
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
  let variantA: string;
  let variantB: string;
  let stepId: string;
  const firstSent = new Date(Date.now() - 30 * 86_400_000);

  const http = () => request(app.getHttpServer());
  const auth = () => `Bearer ${token}`;
  const q = <T>(
    fn: (c: Parameters<Parameters<typeof withOrgContext>[2]>[0]) => Promise<T>,
  ) => withOrgContext(pool, orgId, fn);

  /** One company: `contacts` people, all sent step 1 at `firstSent`. */
  const company = async (
    key: string,
    variant: string,
    contacts = 1,
    opts: { city?: string; trigger?: string } = {},
  ) => {
    const out: { leadId: string; clId: string; seId: string }[] = [];
    await q(async (c) => {
      await c.query(
        `INSERT INTO experiment_assignments (org_id, experiment_id, company_key, variant_id, hash)
         VALUES ($1,$2,$3,$4,'t')`,
        [orgId, experimentId, key, variant],
      );
      for (let k = 0; k < contacts; k++) {
        const lead = await c.query<{ id: string }>(
          `INSERT INTO leads (org_id, email, company_key, city)
           VALUES ($1,$2,$3,$4) RETURNING id`,
          [orgId, `p${k}@${key}`, key, opts.city ?? null],
        );
        const snap = {
          company_key: key,
          city: opts.city ?? null,
          primary_trigger: opts.trigger ?? 'unknown',
        };
        const cl = await c.query<{ id: string }>(
          `INSERT INTO campaign_leads (org_id, campaign_id, lead_id, status, snapshot)
           VALUES ($1,$2,$3,'active',$4::jsonb) RETURNING id`,
          [orgId, campaignId, lead.rows[0].id, JSON.stringify(snap)],
        );
        const se = await c.query<{ id: string }>(
          `INSERT INTO sent_emails (org_id, campaign_id, campaign_lead_id, lead_id, step_id,
              to_email, subject, status, experiment_id, variant_id, sent_at)
           VALUES ($1,$2,$3,$4,$5,$6,'s','sent',$7,$8,$9) RETURNING id`,
          [
            orgId,
            campaignId,
            cl.rows[0].id,
            lead.rows[0].id,
            stepId,
            `p${k}@${key}`,
            experimentId,
            variant,
            firstSent,
          ],
        );
        out.push({
          leadId: lead.rows[0].id,
          clId: cl.rows[0].id,
          seId: se.rows[0].id,
        });
      }
    });
    return out;
  };

  const outcome = (
    key: string,
    variant: string,
    ref: { leadId: string; clId: string; seId: string } | null,
    type: string,
    verification: string,
    daysAfterSend: number,
    idem = randomUUID(),
  ) =>
    q((c) =>
      c.query(
        `INSERT INTO outcome_events (org_id, campaign_lead_id, lead_id, company_key, experiment_id,
            variant_id, sent_email_id, type, source, verification, occurred_at, idempotency_key, reason)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'manual',$9,$10,$11,NULL)`,
        [
          orgId,
          ref?.clId ?? null,
          ref?.leadId ?? null,
          key,
          experimentId,
          variant,
          ref?.seId ?? null,
          type,
          verification,
          new Date(firstSent.getTime() + daysAfterSend * 86_400_000),
          idem,
        ],
      ),
    );

  const review = async () =>
    (
      await http()
        .get(`/campaigns/${campaignId}/review`)
        .set('Authorization', auth())
        .expect(200)
    ).body;
  const refresh = () =>
    http()
      .post(`/campaigns/${campaignId}/review/refresh`)
      .set('Authorization', auth());

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
    app.get(ReviewService).refreshCooldownMs = 0;

    const a = await http()
      .post('/auth/signup')
      .send({
        email: `t05-a-${randomUUID().slice(0, 8)}@test.local`,
        password: 't05-password-123',
        name: 'T05 Admin',
        orgName: 'T05 Org A',
      })
      .expect(201);
    token = a.body.accessToken;
    orgId = a.body.org.id;
    userId = a.body.user.id;
    const b = await http()
      .post('/auth/signup')
      .send({
        email: `t05-b-${randomUUID().slice(0, 8)}@test.local`,
        password: 't05-password-123',
        name: 'T05 Other',
        orgName: 'T05 Org B',
      })
      .expect(201);
    otherToken = b.body.accessToken;
    otherOrgId = b.body.org.id;
    otherUserId = b.body.user.id;
    const inv = await http()
      .post('/orgs/invites')
      .set('Authorization', auth())
      .send({
        email: `t05-agent-${randomUUID().slice(0, 8)}@test.local`,
        role: 'agent',
      })
      .expect(201);
    const reg = await http()
      .post(`/invites/${inv.body.token}/register`)
      .send({ name: 'T05 Agent', password: 'agent-pass-123' })
      .expect(201);
    agentToken = reg.body.accessToken;
    agentId = reg.body.user.id;

    // campaign + step + running experiment with two variants (inserted directly)
    await q(async (c) => {
      const camp = await c.query<{ id: string }>(
        `INSERT INTO campaigns (org_id, name, status) VALUES ($1,'T05 review','active') RETURNING id`,
        [orgId],
      );
      campaignId = camp.rows[0].id;
      const st = await c.query<{ id: string }>(
        `INSERT INTO campaign_steps (org_id, campaign_id, step_order, delay_hours)
         VALUES ($1,$2,1,0) RETURNING id`,
        [orgId, campaignId],
      );
      stepId = st.rows[0].id;
      const ex = await c.query<{ id: string }>(
        `INSERT INTO experiments (org_id, campaign_id, step_id, status, baseline_rate, min_lift_pp,
            target_n_per_arm, response_window_days, started_at, created_by)
         VALUES ($1,$2,$3,'running',0.03,2,NULL,14,now(),$4) RETURNING id`,
        [orgId, campaignId, stepId, userId],
      );
      experimentId = ex.rows[0].id;
      for (const [i, label] of ['A', 'B'].entries()) {
        const v = await c.query<{ id: string }>(
          `INSERT INTO experiment_variants (org_id, experiment_id, label, subject, is_control, status)
           VALUES ($1,$2,$3,$4,$5,'active') RETURNING id`,
          [orgId, experimentId, label, `Subject ${label}`, i === 0],
        );
        if (i === 0) variantA = v.rows[0].id;
        else variantB = v.rows[0].id;
      }
    });

    // Company 1: TWO contacts, both replied qualified -> still ONE company
    const two = await company('two-contacts.test', variantB, 2, {
      city: 'Pune',
      trigger: 'hiring',
    });
    await outcome(
      'two-contacts.test',
      variantB,
      two[0],
      'qualified_reply',
      'verified',
      3,
    );
    await outcome(
      'two-contacts.test',
      variantB,
      two[1],
      'qualified_reply',
      'verified',
      4,
    );
    // Company 2: qualified reply arrived AFTER the 14-day window -> excluded from the count
    const late = await company('late.test', variantB, 1, {
      city: 'Pune',
      trigger: 'hiring',
    });
    await outcome(
      'late.test',
      variantB,
      late[0],
      'qualified_reply',
      'verified',
      20,
    );
    await outcome('late.test', variantB, late[0], 'reply', 'verified', 20);
    // Company 3: AI-labelled only (provisional) -> not verified
    const prov = await company('provisional.test', variantA, 1, {
      city: 'Mumbai',
    });
    await outcome(
      'provisional.test',
      variantA,
      prov[0],
      'reply',
      'verified',
      2,
    );
    await outcome(
      'provisional.test',
      variantA,
      prov[0],
      'qualified_reply',
      'provisional',
      2,
    );
    // Company 4: nothing happens
    await company('quiet.test', variantA, 1);
    // an unattributed reply from a person enrolled in this campaign
    await q((c) =>
      c.query(
        `INSERT INTO outcome_events (org_id, lead_id, company_key, type, source, verification, idempotency_key)
         VALUES ($1,$2,'quiet.test','reply','system','verified',$3)`,
        [orgId, two[0].leadId, randomUUID()],
      ),
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

  it('counts companies, not emails: two contacts at one company are ONE verified qualified company', async () => {
    const r = await review();
    expect(r.experimentId).toBe(experimentId);
    expect(r.simulated).toBe(false);
    const arms = r.inputs.arms;
    const a = arms.find((x: any) => x.variantId === variantA);
    const b = arms.find((x: any) => x.variantId === variantB);
    expect(b.assigned).toBe(2); // two-contacts.test + late.test
    expect(b.sent).toBe(2);
    expect(b.qualifiedVerified).toBe(1); // two contacts -> 1; the late one is outside the window
    expect(a.assigned).toBe(2);
  });

  it('a reply after the response window is stored but not counted', async () => {
    const r = await review();
    const b = r.inputs.arms.find((x: any) => x.variantId === variantB);
    expect(b.qualifiedVerified).toBe(1);
    const stored = await q((c) =>
      c.query(
        `SELECT 1 FROM outcome_events WHERE company_key = 'late.test' AND type = 'qualified_reply'`,
      ),
    );
    expect(stored.rowCount).toBe(1);
  });

  it('a provisional (AI-only) qualified reply is not counted as verified', async () => {
    const r = await review();
    const a = r.inputs.arms.find((x: any) => x.variantId === variantA);
    expect(a.qualifiedVerified).toBe(0);
    expect(a.qualifiedProvisional).toBe(1);
    expect(a.replied).toBe(1);
  });

  it('an unattributed reply shows up in the flags (and does not block)', async () => {
    const r = await review();
    expect(r.inputs.flags.unattributedReplies).toBeGreaterThanOrEqual(1);
    expect(r.inputs.flags.ambiguousAttribution).toBe(0);
    const gate = r.result.gates.find((g: any) => g.id === 'attribution_clean');
    expect(gate.passed).toBe(true);
  });

  it('returns the policy decision, plain-words explanation and a source for every number', async () => {
    const r = await review();
    expect(r.result.decision).toBe('keep_collecting');
    expect(r.result.gates).toHaveLength(8);
    expect(r.explanation.summary).toBeTruthy();
    expect(r.explanationSource).toBe('template');
    expect(r.revision).toBe(1);
    expect(r.experiment).toMatchObject({
      id: experimentId,
      responseWindowDays: 14,
    });
    expect(r.result.slices.map((s: any) => s.factor)).toEqual([
      'city',
      'industry',
      'trigger',
    ]);
  });

  it('audience slices fold small buckets into "other" and keep "unknown" visible', async () => {
    const r = await review();
    const city = r.result.slices.find((s: any) => s.factor === 'city');
    const values = city.buckets.map((b: any) => b.value);
    expect(values).toContain('unknown');
    expect(values).toContain('other'); // Pune / Mumbai have < 10 companies each
    expect(values).not.toContain('Pune');
  });

  it('a refresh with unchanged numbers keeps the same revision; a change makes revision 2', async () => {
    const before = await review();
    const same = await refresh().expect(200);
    expect(same.body.changed).toBe(false);
    expect(same.body.revision).toBe(before.revision);

    // a person confirms the AI label: the numbers change
    await q((c) =>
      c.query(
        `UPDATE outcome_events SET verification = 'verified'
          WHERE company_key = 'provisional.test' AND type = 'qualified_reply'`,
      ),
    );
    const next = await refresh().expect(200);
    expect(next.body.changed).toBe(true);
    expect(next.body.revision).toBe(before.revision + 1);
    const a = next.body.inputs.arms.find((x: any) => x.variantId === variantA);
    expect(a.qualifiedVerified).toBe(1);
    expect(a.qualifiedProvisional).toBe(0);

    const again = await refresh().expect(200);
    expect(again.body.changed).toBe(false);
    expect(again.body.revision).toBe(next.body.revision);
    const rows = await q((c) =>
      c.query(
        `SELECT revision FROM reviews WHERE experiment_id = $1 ORDER BY revision`,
        [experimentId],
      ),
    );
    expect(rows.rows.map((x: any) => x.revision)).toEqual([1, 2]);
  });

  it('an older revision can be opened by id (audit link)', async () => {
    const first = await q((c) =>
      c.query(
        `SELECT id FROM reviews WHERE experiment_id = $1 AND revision = 1`,
        [experimentId],
      ),
    );
    const r = await http()
      .get(`/reviews/${first.rows[0].id}`)
      .set('Authorization', auth())
      .expect(200);
    expect(r.body.revision).toBe(1);
    expect(r.body.experiment.id).toBe(experimentId);
  });

  describe('simulation', () => {
    it.each(SCENARIOS.map((s) => [s.id]))(
      '%s runs, is labelled simulated and stores nothing real',
      async (id) => {
        const r = await http()
          .post('/review/simulate')
          .set('Authorization', auth())
          .send({ scenario: id })
          .expect(200);
        expect(r.body.simulated).toBe(true);
        expect(r.body.scenario).toBe(id);
        expect(r.body.experimentId).toBeNull();
        expect(r.body.inputs.simulated).toBe(true);
        expect(r.body.result.decision).toBeTruthy();
      },
    );

    it('gives each scenario the expected decision', async () => {
      const decision = async (id: string) =>
        (
          await http()
            .post('/review/simulate')
            .set('Authorization', auth())
            .send({ scenario: id })
        ).body.result.decision;
      expect(await decision('valid_winner')).toBe('promote');
      expect(await decision('inconclusive_small')).toBe('inconclusive');
      expect(await decision('high_open_low_conv')).toBe('promote');
      expect(await decision('delivery_imbalance')).toBe('keep_collecting');
      expect(await decision('misleading_city')).toBe('inconclusive');
    });

    it('rejects an unknown scenario', async () => {
      await http()
        .post('/review/simulate')
        .set('Authorization', auth())
        .send({ scenario: 'nonsense' })
        .expect(400);
    });

    it('never leaks into real results: the campaign review ignores simulated rows', async () => {
      const real = await review();
      expect(real.simulated).toBe(false);
      expect(real.experimentId).toBe(experimentId);
      const latest = await q((c) =>
        c.query(
          `SELECT max(revision)::int AS m FROM reviews WHERE experiment_id = $1`,
          [experimentId],
        ),
      );
      expect(real.revision).toBe(latest.rows[0].m);
      const simRows = await q((c) =>
        c.query(
          `SELECT count(*)::int AS n FROM reviews WHERE simulated AND experiment_id IS NOT NULL`,
        ),
      );
      expect(simRows.rows[0].n).toBe(0);
      const sims = await q((c) =>
        c.query(`SELECT count(*)::int AS n FROM reviews WHERE simulated`),
      );
      expect(sims.rows[0].n).toBeGreaterThanOrEqual(5);
    });

    it('does not touch real tables (no new sent emails, outcomes or assignments)', async () => {
      const count = () =>
        q((c) =>
          c.query(
            `SELECT (SELECT count(*) FROM outcome_events)::int AS o,
                    (SELECT count(*) FROM sent_emails)::int AS s,
                    (SELECT count(*) FROM experiment_assignments)::int AS a`,
          ),
        );
      const before = await count();
      await http()
        .post('/review/simulate')
        .set('Authorization', auth())
        .send({ scenario: 'valid_winner' });
      expect((await count()).rows[0]).toEqual(before.rows[0]);
    });
  });

  it('a campaign with no experiment answers 404 no_experiment', async () => {
    const camp = await q((c) =>
      c.query<{ id: string }>(
        `INSERT INTO campaigns (org_id, name, status) VALUES ($1,'plain','draft') RETURNING id`,
        [orgId],
      ),
    );
    const r = await http()
      .get(`/campaigns/${camp.rows[0].id}/review`)
      .set('Authorization', auth())
      .expect(404);
    expect(r.body.error).toBe('no_experiment');
  });

  it('another workspace cannot read or refresh this review (404), nor open its revisions', async () => {
    await http()
      .get(`/campaigns/${campaignId}/review`)
      .set('Authorization', `Bearer ${otherToken}`)
      .expect(404);
    await http()
      .post(`/campaigns/${campaignId}/review/refresh`)
      .set('Authorization', `Bearer ${otherToken}`)
      .expect(404);
    const rev = await q((c) =>
      c.query(`SELECT id FROM reviews WHERE experiment_id = $1 LIMIT 1`, [
        experimentId,
      ]),
    );
    await http()
      .get(`/reviews/${rev.rows[0].id}`)
      .set('Authorization', `Bearer ${otherToken}`)
      .expect(404);
  });

  it('roles: an agent can read and simulate but not refresh', async () => {
    await http()
      .get(`/campaigns/${campaignId}/review`)
      .set('Authorization', `Bearer ${agentToken}`)
      .expect(200);
    await http()
      .post('/review/simulate')
      .set('Authorization', `Bearer ${agentToken}`)
      .send({ scenario: 'valid_winner' })
      .expect(200);
    await http()
      .post(`/campaigns/${campaignId}/review/refresh`)
      .set('Authorization', `Bearer ${agentToken}`)
      .expect(403);
  });

  it('refresh is limited to once per 30 seconds per campaign (429)', async () => {
    const svc = app.get(ReviewService);
    svc.refreshCooldownMs = 30_000;
    try {
      // the first call may be allowed or already inside a window from earlier tests
      await refresh();
      const second = await refresh();
      expect(second.status).toBe(429);
      expect(second.body.error).toBe('refresh_limited');
    } finally {
      svc.refreshCooldownMs = 0;
    }
  });
});
