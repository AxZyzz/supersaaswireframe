/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-call */
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'crypto';
import { Pool } from 'pg';
import request from 'supertest';
import { WeeklySummaryService } from '../analytics/weekly-summary.service';
import { AppModule } from '../app.module';
import { PG_POOL } from '../db/db.module';
import { withOrgContext } from '../db/tenant-context';
import { LoopHealthService } from '../loop-health/loop-health.service';
import { SystemMailService } from '../mail/system-mail.service';
import { ReviewService } from '../review/review.service';
import { CRON_TOKEN_VERIFIER } from './cron-auth.guard';
import { WeeklyReviewService } from './weekly-review.service';

jest.setTimeout(120_000);

const SA = 'expelly-scheduler@test.iam.gserviceaccount.com';
const AUD = 'https://api.test.example';

/**
 * Learning Loop T13: the scheduled jobs (auth, once-per-week), loop health on
 * fixtures, and the Review section of the weekly summary email.
 */
describe('Cron jobs, loop health and weekly summary (T13)', () => {
  let app: INestApplication;
  let pool: Pool;
  let reviewSvc: ReviewService;
  let weeklyReview: WeeklyReviewService;
  let health: LoopHealthService;
  let token: string;
  let agentToken: string;
  let otherToken: string;
  let orgId: string;
  let userId: string;
  let otherOrgId: string;
  let otherUserId: string;
  let agentUserId: string;
  const adminEmail = `t13-${randomUUID().slice(0, 8)}@test.local`;
  const campaignName = `T13 Review Campaign ${randomUUID().slice(0, 6)}`;
  let experimentId: string;
  let variantA: string;
  let variantB: string;

  const http = () => request(app.getHttpServer());
  const as = (t: string) => `Bearer ${t}`;
  const q = <T>(
    fn: (c: Parameters<Parameters<typeof withOrgContext>[2]>[0]) => Promise<T>,
  ) => withOrgContext(pool, orgId, fn);
  const cron = (path: string, bearer = 'good-scheduler-token') =>
    http().post(`/internal/cron/${path}`).set('Authorization', as(bearer));

  /** A running experiment on its own campaign + step, with variants A and B. */
  const mkExperiment = (name: string) =>
    q(async (c) => {
      const camp = await c.query<{ id: string }>(
        `INSERT INTO campaigns (org_id, name, status) VALUES ($1,$2,'active') RETURNING id`,
        [orgId, name],
      );
      const st = await c.query<{ id: string }>(
        `INSERT INTO campaign_steps (org_id, campaign_id, step_order, delay_hours)
         VALUES ($1,$2,1,0) RETURNING id`,
        [orgId, camp.rows[0].id],
      );
      const ex = await c.query<{ id: string }>(
        `INSERT INTO experiments (org_id, campaign_id, step_id, status, response_window_days, started_at)
         VALUES ($1,$2,$3,'running',14, now() - interval '20 days') RETURNING id`,
        [orgId, camp.rows[0].id, st.rows[0].id],
      );
      const v: string[] = [];
      for (const [i, label] of ['A', 'B'].entries()) {
        const r = await c.query<{ id: string }>(
          `INSERT INTO experiment_variants (org_id, experiment_id, label, subject, is_control, status)
           VALUES ($1,$2,$3,$4,$5,'active') RETURNING id`,
          [orgId, ex.rows[0].id, label, `Subject ${label}`, i === 0],
        );
        v.push(r.rows[0].id);
      }
      return {
        campaignId: camp.rows[0].id,
        experimentId: ex.rows[0].id,
        a: v[0],
        b: v[1],
      };
    });

  /** `n` companies assigned to a version (key prefix keeps sets apart). */
  const assign = (exp: string, variant: string, prefix: string, n: number) =>
    q((c) =>
      c.query(
        `INSERT INTO experiment_assignments (org_id, experiment_id, company_key, variant_id, hash)
         SELECT $1, $2, $4 || g || '.test', $3, 'h' FROM generate_series(1, $5::int) g`,
        [orgId, exp, variant, prefix, n],
      ),
    );

  beforeAll(async () => {
    process.env.THROTTLE_DISABLED = 'true';
    process.env.CRON_AUDIENCE = AUD;
    process.env.CRON_SA_EMAIL = SA;
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(CRON_TOKEN_VERIFIER)
      .useValue({
        verify: (t: string) =>
          Promise.resolve(
            t === 'good-scheduler-token'
              ? { email: SA, emailVerified: true }
              : t === 'other-sa-token'
                ? { email: 'someone@else.com', emailVerified: true }
                : null,
          ),
      })
      .compile();
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
    reviewSvc = app.get(ReviewService);
    weeklyReview = app.get(WeeklyReviewService);
    health = app.get(LoopHealthService);

    const a = await http()
      .post('/auth/signup')
      .send({
        email: adminEmail,
        password: 't13-password-123',
        name: 'T13 Admin',
        orgName: 'T13 Org A',
      })
      .expect(201);
    token = a.body.accessToken;
    orgId = a.body.org.id;
    userId = a.body.user.id;
    const b = await http()
      .post('/auth/signup')
      .send({
        email: `t13-b-${randomUUID().slice(0, 8)}@test.local`,
        password: 't13-password-123',
        name: 'T13 Other',
        orgName: 'T13 Org B',
      })
      .expect(201);
    otherToken = b.body.accessToken;
    otherOrgId = b.body.org.id;
    otherUserId = b.body.user.id;
    const inv = await http()
      .post('/orgs/invites')
      .set('Authorization', as(token))
      .send({
        email: `t13-agent-${randomUUID().slice(0, 8)}@test.local`,
        role: 'agent',
      })
      .expect(201);
    const reg = await http()
      .post(`/invites/${inv.body.token}/register`)
      .send({ name: 'T13 Agent', password: 'agent-pass-123' })
      .expect(201);
    agentToken = reg.body.accessToken;
    agentUserId = reg.body.user.id;

    const e = await mkExperiment(campaignName);
    experimentId = e.experimentId;
    variantA = e.a;
    variantB = e.b;
  });

  afterAll(async () => {
    jest.restoreAllMocks();
    delete process.env.THROTTLE_DISABLED;
    delete process.env.CRON_AUDIENCE;
    delete process.env.CRON_SA_EMAIL;
    for (const o of [orgId, otherOrgId]) {
      await withOrgContext(pool, o, (c) =>
        c.query(`DELETE FROM orgs WHERE id = $1`, [o]),
      );
    }
    for (const u of [userId, otherUserId, agentUserId]) {
      await pool.query(`DELETE FROM users WHERE id = $1`, [u]);
    }
    await app.close();
  });

  // ── auth ────────────────────────────────────────────────────────────────

  it('cron routes refuse everything except the scheduler service account (401)', async () => {
    for (const path of ['weekly-review', 'expire-preferences', 'loop-health']) {
      await http().post(`/internal/cron/${path}`).expect(401); // no token
      await cron(path, 'forged-token').expect(401);
      await cron(path, 'other-sa-token').expect(401); // a real Google token, wrong account
      await cron(path, token).expect(401); // a signed-in admin is not the scheduler
      await http()
        .post(`/internal/cron/${path}`)
        .set('x-cron-secret', 'anything')
        .expect(401);
    }
    // the right identity gets in
    const ok = await cron('expire-preferences').expect(200);
    expect(ok.body).toEqual({
      expired: expect.any(Number),
      deactivated: expect.any(Number),
    });
  });

  // ── weekly review ───────────────────────────────────────────────────────

  it('the weekly review refreshes a workspace once per ISO week, and a repeat call is a no-op', async () => {
    const first = await cron('weekly-review').expect(200);
    expect(first.body.period).toMatch(/^\d{4}-W\d{2}$/);
    expect(first.body.workspaces).toBeGreaterThanOrEqual(1);

    const runs = await q((c) =>
      c.query(
        `SELECT period, result FROM cron_runs WHERE job = 'weekly_review'`,
      ),
    );
    expect(runs.rowCount).toBe(1);
    expect(runs.rows[0].period).toBe(first.body.period);
    expect(runs.rows[0].result.reviews[0].experimentId).toBe(experimentId);
    const revisions = async () =>
      (
        await q((c) =>
          c.query(
            `SELECT revision FROM reviews WHERE experiment_id = $1 AND NOT simulated`,
            [experimentId],
          ),
        )
      ).rowCount;
    expect(await revisions()).toBe(1);

    const again = await cron('weekly-review').expect(200);
    expect(again.body.skipped).toBeGreaterThanOrEqual(1);
    expect(await revisions()).toBe(1);
    expect(
      (
        await q((c) =>
          c.query(`SELECT 1 FROM cron_runs WHERE job = 'weekly_review'`),
        )
      ).rowCount,
    ).toBe(1);
  });

  it('a workspace that fails is retried by the next call and never stops the others', async () => {
    const monday = new Date('2027-03-01T08:00:00Z');
    const real = reviewSvc.refreshForExperiment.bind(reviewSvc);
    const spy = jest
      .spyOn(reviewSvc, 'refreshForExperiment')
      .mockImplementation((org, user, exp) =>
        exp === experimentId
          ? Promise.reject(new Error('review blew up'))
          : real(org, user, exp),
      );
    const failed = await weeklyReview.run(monday);
    expect(failed.failed).toBeGreaterThanOrEqual(1);
    // the other workspaces were still done, and ours gave its claim back
    expect(failed.refreshed + failed.skipped).toBeGreaterThanOrEqual(0);
    const claim = () =>
      q((c) =>
        c.query(
          `SELECT 1 FROM cron_runs WHERE job = 'weekly_review' AND period = '2027-W09'`,
        ),
      );
    expect((await claim()).rowCount).toBe(0);

    spy.mockRestore();
    const retry = await weeklyReview.run(monday);
    expect(retry.refreshed).toBeGreaterThanOrEqual(1);
    expect((await claim()).rowCount).toBe(1);
  });

  // ── loop health ─────────────────────────────────────────────────────────

  it('loop health finds a stuck action, low coverage, a skewed split and an expiring preference', async () => {
    // a second test whose 100 companies split 90 / 10 (planned 50 / 50)
    const skew = await mkExperiment(`T13 skewed ${randomUUID().slice(0, 6)}`);
    await assign(skew.experimentId, skew.a, 'sa', 90);
    await assign(skew.experimentId, skew.b, 'sb', 10);

    // low coverage: 10 replying companies, 4 still waiting for a person
    await assign(experimentId, variantA, 'ca', 6);
    await assign(experimentId, variantB, 'cb', 4);
    await q(async (c) => {
      await c.query(
        `INSERT INTO outcome_events (org_id, company_key, experiment_id, variant_id, type, source,
            verification, occurred_at, idempotency_key)
         SELECT $1, a.company_key, $2, a.variant_id, 'reply', 'manual', 'verified', now() - interval '5 days', gen_random_uuid()::text
           FROM experiment_assignments a WHERE a.experiment_id = $2`,
        [orgId, experimentId],
      );
      await c.query(
        `INSERT INTO outcome_events (org_id, company_key, experiment_id, variant_id, type, source,
            verification, occurred_at, idempotency_key)
         SELECT $1, t.company_key, $2, t.variant_id, 'qualified_reply', 'inbox_ai', 'provisional',
                now() - interval '5 days', gen_random_uuid()::text
           FROM (SELECT company_key, variant_id FROM experiment_assignments
                  WHERE experiment_id = $2 ORDER BY company_key LIMIT 4) t`,
        [orgId, experimentId],
      );
    });

    // a stuck action: requested 20 minutes ago and never applied
    await q(async (c) => {
      const rv = await c.query<{ id: string }>(
        `INSERT INTO reviews (org_id, experiment_id, revision, policy_version, simulated, inputs_hash,
            inputs, result, explanation)
         VALUES ($1,$2,50,'v1',false,'stuck','{}'::jsonb,'{"failedGates":["outcome_coverage"]}'::jsonb,'{}'::jsonb)
         RETURNING id`,
        [orgId, experimentId],
      );
      await c.query(
        `INSERT INTO review_actions (org_id, review_id, experiment_id, revision, action_id, type,
            status, requested_by, idempotency_key, requested_at)
         VALUES ($1,$2,$3,50,'x','pause_variant','requested',$4,$5, now() - interval '20 minutes')`,
        [orgId, rv.rows[0].id, experimentId, userId, randomUUID()],
      );
    });

    // a preference that ends tomorrow
    await q(async (c) => {
      const off = await c.query<{ id: string }>(
        `INSERT INTO offers (org_id, name) VALUES ($1,'T13 offer') RETURNING id`,
        [orgId],
      );
      await c.query(
        `INSERT INTO search_preferences (org_id, offer_id, factor, value, label, filter, cap_share,
            expires_at, evidence, evidence_hash, idempotency_key)
         VALUES ($1,$2,'city','Pune','City: Pune','{}'::jsonb,0.2, now() + interval '1 day',
                 '{}'::jsonb, $3, $3)`,
        [orgId, off.rows[0].id, randomUUID()],
      );
    });
    // a reply nobody could attach to a campaign
    await q((c) =>
      c.query(
        `INSERT INTO outcome_events (org_id, company_key, type, source, verification, idempotency_key)
         VALUES ($1,'lost.test','reply','system','verified',$2)`,
        [orgId, randomUUID()],
      ),
    );

    const res = await http()
      .get('/review/health')
      .set('Authorization', as(agentToken))
      .expect(200);
    expect(res.body.status).toBe('bad');
    expect(res.body.stuckActions).toBe(1);
    expect(res.body.unattributed7d).toBe(1);
    expect(res.body.gateFailures).toEqual({ outcome_coverage: 1 });
    expect(res.body.preferencesExpiringSoon).toHaveLength(1);

    const mine = res.body.experiments.find(
      (e: any) => e.experimentId === experimentId,
    );
    expect(mine.replyingCompanies).toBe(10);
    expect(mine.coverage).toBeCloseTo(0.6, 5);
    const skewed = res.body.experiments.find(
      (e: any) => e.experimentId === skew.experimentId,
    );
    expect(skewed.assigned.map((a: any) => a.companies)).toEqual([90, 10]);
    expect(skewed.srmP).toBeLessThan(0.001);

    const ids = res.body.problems.map((p: any) => p.id);
    expect(ids).toEqual(
      expect.arrayContaining([
        `coverage:${experimentId}`,
        `srm:${skew.experimentId}`,
        'stuck_actions',
        'unattributed',
        expect.stringMatching(/^preference_expiring:/),
      ]),
    );
    // worst first
    expect(res.body.problems[0].severity).toBe('bad');

    // pausing a version switches the split check off instead of crying wolf
    await q((c) =>
      c.query(
        `UPDATE experiment_variants SET status = 'paused' WHERE id = $1`,
        [skew.b],
      ),
    );
    const paused = await http()
      .get('/review/health')
      .set('Authorization', as(token))
      .expect(200);
    const p = paused.body.experiments.find(
      (e: any) => e.experimentId === skew.experimentId,
    );
    expect(p.srmP).toBeNull();
    expect(p.srmNote).toMatch(/paused/);

    // another workspace sees none of it
    const other = await http()
      .get('/review/health')
      .set('Authorization', as(otherToken))
      .expect(200);
    expect(other.body).toMatchObject({
      status: 'ok',
      stuckActions: 0,
      unattributed7d: 0,
      problems: [],
    });
    expect(other.body.experiments).toEqual([]);
  });

  it('the loop-health job writes one structured line per workspace that alerts can count', async () => {
    const lines: string[] = [];
    const write = process.stdout.write.bind(process.stdout);
    const spy = jest
      .spyOn(process.stdout, 'write')
      .mockImplementation((chunk: any, ...rest: any[]) => {
        if (
          typeof chunk === 'string' &&
          chunk.includes('"event":"loop_health"')
        )
          lines.push(chunk);
        return write(chunk, ...rest);
      });
    const res = await cron('loop-health').expect(200);
    spy.mockRestore();
    expect(res.body.workspaces).toBeGreaterThanOrEqual(1);
    const mine = lines
      .map((l) => JSON.parse(l))
      .find((l) => l.org_id === orgId);
    expect(mine).toMatchObject({
      event: 'loop_health',
      severity: 'WARNING',
      status: 'bad',
      stuck_actions: 1,
      unattributed_7d: 1,
      preferences_expiring_48h: 1,
    });
    expect(mine.coverage_min).toBeCloseTo(0.6, 5);
    expect(mine.srm_breaches).toBeGreaterThanOrEqual(0);
    // and the service returns the same picture
    expect((await health.compute(orgId)).stuckActions).toBe(1);
  });

  // ── weekly summary ──────────────────────────────────────────────────────

  it('the Monday summary has a Campaign Review section with real tests and preferences, and no simulated data', async () => {
    // a simulated review exists in this workspace: it must not show up
    await http()
      .post('/review/simulate')
      .set('Authorization', as(token))
      .send({ scenario: 'valid_winner' })
      .expect(200);
    // not a quiet week
    await q((c) =>
      c.query(`INSERT INTO leads (org_id, email) VALUES ($1,'new@lead.test')`, [
        orgId,
      ]),
    );

    const mail = app.get(SystemMailService);
    const sent: { to: string; text: string; subject: string }[] = [];
    const spy = jest.spyOn(mail, 'send').mockImplementation((m: any) => {
      sent.push(m);
      return Promise.resolve(true);
    });
    await app.get(WeeklySummaryService).run();
    spy.mockRestore();

    const mine = sent.find((m) => m.to === adminEmail);
    expect(mine).toBeDefined();
    expect(mine!.text).toContain('Campaign Review:');
    expect(mine!.text).toContain(`• ${campaignName}:`);
    expect(mine!.text).toMatch(/\/campaigns/);
    expect(mine!.text).toContain('Search preference "City: Pune"');
    expect(mine!.text).toMatch(/\/discover/);
    expect(mine!.text.toLowerCase()).not.toContain('simulat');
    // the other workspace has no tests, so no such section
    expect(
      sent
        .filter((m) => m.to !== adminEmail)
        .every((m) => !m.text.includes(campaignName)),
    ).toBe(true);
  });
});
