/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-return */
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'crypto';
import { Pool } from 'pg';
import request from 'supertest';
import { AppModule } from '../app.module';
import { PG_POOL } from '../db/db.module';
import { withOrgContext } from '../db/tenant-context';
import { SendersService } from '../senders/senders.service';
import { verifyAllSenders } from '../../test/verify-senders';

jest.setTimeout(60_000);

describe('Offers, enrollment snapshot, experiments and assignment (T02)', () => {
  let app: INestApplication;
  let pool: Pool;
  let token: string;
  let orgId: string;
  let userId: string;
  let otherToken: string;
  let otherOrgId: string;
  let otherUserId: string;
  let templateId: string;

  const http = () => request(app.getHttpServer());
  const auth = () => `Bearer ${token}`;
  const otherAuth = () => `Bearer ${otherToken}`;

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

    const r1 = await http()
      .post('/auth/signup')
      .send({
        email: `t02-a-${randomUUID().slice(0, 8)}@test.local`,
        password: 't02-password-123',
        name: 'T02 Admin',
        orgName: 'T02 Org A',
      })
      .expect(201);
    token = r1.body.accessToken;
    orgId = r1.body.org.id;
    userId = r1.body.user.id;

    const r2 = await http()
      .post('/auth/signup')
      .send({
        email: `t02-b-${randomUUID().slice(0, 8)}@test.local`,
        password: 't02-password-123',
        name: 'T02 Other',
        orgName: 'T02 Org B',
      })
      .expect(201);
    otherToken = r2.body.accessToken;
    otherOrgId = r2.body.org.id;
    otherUserId = r2.body.user.id;

    // Verified sender for Org A with plenty of daily capacity
    await http()
      .post('/senders')
      .set('Authorization', auth())
      .send({
        provider: 'smtp',
        fromName: 'T02 Rep',
        fromEmail: 'rep@t02.local',
        dailyLimit: 500,
      })
      .expect(201);
    await verifyAllSenders(app.getHttpServer(), auth());
    await withOrgContext(pool, orgId, (c) =>
      c.query(
        `UPDATE sender_accounts SET warmup_enabled = false, daily_limit = 500`,
      ),
    );

    const tpls = await http()
      .get('/templates')
      .set('Authorization', auth())
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
    for (const u of [userId, otherUserId]) {
      await pool.query(`DELETE FROM users WHERE id = $1`, [u]);
    }
    await app.close();
  });

  it('auto-creates Default offer on first use, allows creating offers, and enforces RLS', async () => {
    const list1 = await http()
      .get('/offers')
      .set('Authorization', auth())
      .expect(200);
    expect(list1.body).toHaveLength(1);
    expect(list1.body[0].name).toBe('Default offer');

    const created = await http()
      .post('/offers')
      .set('Authorization', auth())
      .send({
        name: 'Missed-call follow-up for clinics',
        description: 'Automated WhatsApp + SMS callback within 30s',
      })
      .expect(201);
    expect(created.body.name).toBe('Missed-call follow-up for clinics');

    // Org B cannot see or edit Org A's offer
    await http()
      .patch(`/offers/${created.body.id}`)
      .set('Authorization', otherAuth())
      .send({ name: 'Hijacked' })
      .expect(404);
  });

  it('writes frozen enrollment snapshot once with all keys and does not mutate it when lead city changes', async () => {
    const seg = await http()
      .post('/segments')
      .set('Authorization', auth())
      .send({ name: `SnapSeg-${randomUUID().slice(0, 6)}`, type: 'manual' })
      .expect(201);

    const lead = await http()
      .post('/leads')
      .set('Authorization', auth())
      .send({
        email: 'founder@puneclinic.in',
        firstName: 'Asha',
        company: 'Pune Clinic',
        title: 'Co-Founder & CEO',
        source: 'expelly',
        custom: {
          website: 'https://puneclinic.in',
          city: 'Pune',
          region: 'Maharashtra',
          country: 'IN',
          expellyStars: 4,
          expellyFitScore: 76,
        },
      })
      .expect(201);

    await http()
      .post(`/segments/${seg.body.id}/members`)
      .set('Authorization', auth())
      .send({ leadIds: [lead.body.id] })
      .expect(200);

    const camp = await http()
      .post('/campaigns')
      .set('Authorization', auth())
      .send({ name: 'Snapshot Test Campaign', segmentId: seg.body.id })
      .expect(201);
    expect(camp.body.offer_id).toBeTruthy();

    await http()
      .post(`/campaigns/${camp.body.id}/steps`)
      .set('Authorization', auth())
      .send({ templateId, delayHours: 24 })
      .expect(201);

    await http()
      .post(`/campaigns/${camp.body.id}/enroll`)
      .set('Authorization', auth())
      .expect(200);

    const snapBefore = await withOrgContext(pool, orgId, async (c) => {
      const r = await c.query(
        `SELECT snapshot FROM campaign_leads WHERE campaign_id = $1 AND lead_id = $2`,
        [camp.body.id, lead.body.id],
      );
      return r.rows[0]?.snapshot;
    });

    expect(snapBefore).toMatchObject({
      company_key: 'puneclinic.in',
      city: 'Pune',
      region: 'Maharashtra',
      country: 'IN',
      timezone: 'Asia/Kolkata',
      industry: 'unknown',
      size_band: 'unknown',
      triggers: [],
      primary_trigger: 'unknown',
      mail_provider: 'unknown',
      role_bucket: 'founder_owner',
      stars: 4,
      fit_score: 76,
      prospect_id: null,
      discovery_run_id: null,
      preference_id: null,
      preference_revision: null,
      source: 'expelly',
      offer_id: camp.body.offer_id,
      snapshot_version: 1,
    });

    // Now edit the lead's city in leads table + re-run enroll
    await http()
      .patch(`/leads/${lead.body.id}`)
      .set('Authorization', auth())
      .send({ custom: { city: 'Mumbai', country: 'IN' } })
      .expect(200);
    await http()
      .post(`/campaigns/${camp.body.id}/enroll`)
      .set('Authorization', auth())
      .expect(200);

    const snapAfter = await withOrgContext(pool, orgId, async (c) => {
      const r = await c.query(
        `SELECT snapshot FROM campaign_leads WHERE campaign_id = $1 AND lead_id = $2`,
        [camp.body.id, lead.body.id],
      );
      return r.rows[0]?.snapshot;
    });
    expect(snapAfter).toEqual(snapBefore);
    expect(snapAfter.city).toBe('Pune');
  });

  it('freezes variants, audience segment, senders, step delays and template copy while experiment is running (409 experiment_running)', async () => {
    const seg1 = await http()
      .post('/segments')
      .set('Authorization', auth())
      .send({ name: `FreezeSeg1-${randomUUID().slice(0, 6)}`, type: 'manual' })
      .expect(201);
    const seg2 = await http()
      .post('/segments')
      .set('Authorization', auth())
      .send({ name: `FreezeSeg2-${randomUUID().slice(0, 6)}`, type: 'manual' })
      .expect(201);

    const tpl = await http()
      .post('/templates')
      .set('Authorization', auth())
      .send({
        name: `FreezeTpl-${randomUUID().slice(0, 6)}`,
        subject: 'Original subject',
        bodyHtml: '<p>Hi {first_name|there}</p>',
      })
      .expect(201);

    const camp = await http()
      .post('/campaigns')
      .set('Authorization', auth())
      .send({ name: 'Freeze Campaign', segmentId: seg1.body.id })
      .expect(201);

    const step1 = await http()
      .post(`/campaigns/${camp.body.id}/steps`)
      .set('Authorization', auth())
      .send({ templateId: tpl.body.id, delayHours: 0 })
      .expect(201);
    const step2 = await http()
      .post(`/campaigns/${camp.body.id}/steps`)
      .set('Authorization', auth())
      .send({ templateId: tpl.body.id, delayHours: 48 })
      .expect(201);

    // Experiment on step 2 is rejected (step 1 only in V1)
    await http()
      .post(`/campaigns/${camp.body.id}/experiments`)
      .set('Authorization', auth())
      .send({
        stepId: step2.body.id,
        variants: [
          { label: 'A', subject: 'Subj A' },
          { label: 'B', subject: 'Subj B' },
        ],
      })
      .expect(400);

    // Create and start experiment on step 1
    const exp = await http()
      .post(`/campaigns/${camp.body.id}/experiments`)
      .set('Authorization', auth())
      .send({
        stepId: step1.body.id,
        variants: [
          { label: 'A', subject: 'Quick question for {company}' },
          { label: 'B', subject: 'Missed calls at {company}' },
        ],
      })
      .expect(201);
    expect(exp.body.status).toBe('draft');
    expect(exp.body.response_window_days).toBe(14);
    expect(exp.body.min_lift_pp).toBe(2);

    const started = await http()
      .post(`/experiments/${exp.body.id}/start`)
      .set('Authorization', auth())
      .expect(200);
    expect(started.body.status).toBe('running');

    // 1. Editing variant subjects on running experiment -> 409
    const editExp = await http()
      .patch(`/experiments/${exp.body.id}`)
      .set('Authorization', auth())
      .send({
        variants: [
          { label: 'A', subject: 'Changed A' },
          { label: 'B', subject: 'Changed B' },
        ],
      })
      .expect(409);
    expect(editExp.body.error).toBe('experiment_running');
    expect(editExp.body.message).toBe(
      'Editing copy creates a new test. Stop this one first.',
    );

    // 2. Editing audience segment -> 409
    const editSeg = await http()
      .patch(`/campaigns/${camp.body.id}`)
      .set('Authorization', auth())
      .send({ segmentId: seg2.body.id })
      .expect(409);
    expect(editSeg.body.error).toBe('experiment_running');

    // 3. Editing sender list -> 409
    const editSenders = await http()
      .patch(`/campaigns/${camp.body.id}`)
      .set('Authorization', auth())
      .send({ senderIds: [] })
      .expect(409);
    expect(editSenders.body.error).toBe('experiment_running');

    // 4. Editing step delay -> 409
    const editDelay = await http()
      .patch(`/campaigns/steps/${step2.body.id}`)
      .set('Authorization', auth())
      .send({ delayHours: 72 })
      .expect(409);
    expect(editDelay.body.error).toBe('experiment_running');

    // 5. Editing template copy -> 409
    const editTpl = await http()
      .patch(`/templates/${tpl.body.id}`)
      .set('Authorization', auth())
      .send({ bodyHtml: '<p>Changed body</p>' })
      .expect(409);
    expect(editTpl.body.error).toBe('experiment_running');

    // Stopping the experiment unlocks edits
    const stopped = await http()
      .post(`/experiments/${exp.body.id}/stop`)
      .set('Authorization', auth())
      .expect(200);
    expect(stopped.body.status).toBe('stopped');

    await http()
      .patch(`/campaigns/steps/${step2.body.id}`)
      .set('Authorization', auth())
      .send({ delayHours: 72 })
      .expect(200);
  });

  it('assigns 20 leads across 12 companies deterministically, shares variant among colleagues, retries on error without double-assigning, skips leads without company_key, and attributes follow-up steps', async () => {
    const seg = await http()
      .post('/segments')
      .set('Authorization', auth())
      .send({ name: `ExpSeg-${randomUUID().slice(0, 6)}`, type: 'manual' })
      .expect(201);

    // Create 20 leads across 12 companies (8 companies with 2 contacts, 4 with 1 contact)
    const leadIds: string[] = [];
    for (let c = 1; c <= 12; c++) {
      const domain = `clinic-${c}.example.org`;
      const contacts = c <= 8 ? ['alice', 'bob'] : ['owner'];
      for (const person of contacts) {
        const l = await http()
          .post('/leads')
          .set('Authorization', auth())
          .send({
            email: `${person}@${domain}`,
            firstName: person,
            company: `Clinic ${c}`,
          })
          .expect(201);
        leadIds.push(l.body.id);
      }
    }
    expect(leadIds).toHaveLength(20);

    // Also add 1 lead whose company_key is cleared (to test experiment_ineligible)
    const ineligLead = await http()
      .post('/leads')
      .set('Authorization', auth())
      .send({
        email: `mystery-${randomUUID().slice(0, 6)}@inelig.local`,
        firstName: 'NoKey',
      })
      .expect(201);
    await withOrgContext(pool, orgId, (c) =>
      c.query(`UPDATE leads SET company_key = NULL WHERE id = $1`, [
        ineligLead.body.id,
      ]),
    );

    await http()
      .post(`/segments/${seg.body.id}/members`)
      .set('Authorization', auth())
      .send({ leadIds: [...leadIds, ineligLead.body.id] })
      .expect(200);

    const camp = await http()
      .post('/campaigns')
      .set('Authorization', auth())
      .send({ name: '12-Company Experiment', segmentId: seg.body.id })
      .expect(201);

    const s1 = await http()
      .post(`/campaigns/${camp.body.id}/steps`)
      .set('Authorization', auth())
      .send({ templateId, delayHours: 0 })
      .expect(201);
    const s2 = await http()
      .post(`/campaigns/${camp.body.id}/steps`)
      .set('Authorization', auth())
      .send({ templateId, delayHours: 24 })
      .expect(201);

    const exp = await http()
      .post(`/campaigns/${camp.body.id}/experiments`)
      .set('Authorization', auth())
      .send({
        stepId: s1.body.id,
        variants: [
          { label: 'A', subject: 'Version A for {company}' },
          { label: 'B', subject: 'Version B for {company}' },
        ],
      })
      .expect(201);

    await http()
      .post(`/experiments/${exp.body.id}/start`)
      .set('Authorization', auth())
      .expect(200);

    await http()
      .post(`/campaigns/${camp.body.id}/enroll`)
      .set('Authorization', auth())
      .expect(200);

    // Simulate a transient provider error on the very first send call,
    // plus run 3 concurrent ticks to prove concurrency & retry safety.
    const spy = jest
      .spyOn(app.get(SendersService), 'sendMessage')
      .mockRejectedValueOnce(new Error('Temporary SMTP 421 try again'));

    await Promise.all([
      http().post('/sending/tick').set('Authorization', auth()),
      http().post('/sending/tick').set('Authorization', auth()),
      http().post('/sending/tick').set('Authorization', auth()),
    ]);
    spy.mockRestore();

    // Bring the 1 failed lead's retry lease to now() and tick once more
    await withOrgContext(pool, orgId, (c) =>
      c.query(
        `UPDATE campaign_leads SET next_send_at = now()
         WHERE campaign_id = $1 AND current_step = 0 AND status = 'active'`,
        [camp.body.id],
      ),
    );
    await http().post('/sending/tick').set('Authorization', auth()).expect(200);

    await withOrgContext(pool, orgId, async (c) => {
      // 1. Ineligible lead was not assigned and not sent, stopped with experiment_ineligible
      const ineligState = await c.query(
        `SELECT status, stop_reason FROM campaign_leads
         WHERE campaign_id = $1 AND lead_id = $2`,
        [camp.body.id, ineligLead.body.id],
      );
      expect(ineligState.rows[0]).toEqual({
        status: 'stopped',
        stop_reason: 'experiment_ineligible',
      });
      const ineligSent = await c.query(
        `SELECT 1 FROM sent_emails WHERE campaign_id = $1 AND lead_id = $2`,
        [camp.body.id, ineligLead.body.id],
      );
      expect(ineligSent.rowCount).toBe(0);

      // 2. Exactly 12 company assignments (one per company)
      const assigns = await c.query<{
        company_key: string;
        variant_id: string;
      }>(
        `SELECT company_key, variant_id FROM experiment_assignments
         WHERE experiment_id = $1`,
        [exp.body.id],
      );
      expect(assigns.rows).toHaveLength(12);

      // 3. All 20 eligible leads sent step 1, and colleagues at the same company
      //    got the exact same variant_id and rendered subject
      const step1Sends = await c.query<{
        lead_id: string;
        company_key: string;
        subject: string;
        experiment_id: string;
        variant_id: string;
        variant_index: number;
      }>(
        `SELECT se.lead_id, l.company_key, se.subject,
                se.experiment_id, se.variant_id, se.variant_index
         FROM sent_emails se
         JOIN leads l ON l.id = se.lead_id
         WHERE se.campaign_id = $1 AND se.step_id = $2 AND se.status = 'sent'`,
        [camp.body.id, s1.body.id],
      );
      expect(step1Sends.rows).toHaveLength(20);

      const byCompany = new Map<
        string,
        { variantId: string; subject: string }[]
      >();
      for (const row of step1Sends.rows) {
        expect(row.experiment_id).toBe(exp.body.id);
        expect(row.variant_id).toBeTruthy();
        const arr = byCompany.get(row.company_key) ?? [];
        arr.push({ variantId: row.variant_id, subject: row.subject });
        byCompany.set(row.company_key, arr);
      }
      expect(byCompany.size).toBe(12);
      for (const [, sends] of byCompany) {
        // Colleagues at the same company share the exact same variant & subject
        expect(new Set(sends.map((s) => s.variantId)).size).toBe(1);
        expect(new Set(sends.map((s) => s.subject)).size).toBe(1);
      }

      // 4. Advance to follow-up step 2 and verify experiment_id & variant_id attribution
      await c.query(
        `UPDATE campaign_leads SET next_send_at = now()
         WHERE campaign_id = $1 AND current_step = 1 AND status = 'active'`,
        [camp.body.id],
      );
    });

    await http().post('/sending/tick').set('Authorization', auth()).expect(200);

    await withOrgContext(pool, orgId, async (c) => {
      const step2Sends = await c.query<{
        experiment_id: string;
        variant_id: string;
      }>(
        `SELECT experiment_id, variant_id FROM sent_emails
         WHERE campaign_id = $1 AND step_id = $2 AND status = 'sent'`,
        [camp.body.id, s2.body.id],
      );
      expect(step2Sends.rows).toHaveLength(20);
      expect(
        step2Sends.rows.every(
          (r) => r.experiment_id === exp.body.id && !!r.variant_id,
        ),
      ).toBe(true);
    });
  });

  it('keeps legacy round-robin subject_variants behaviour when no experiment is running', async () => {
    const seg = await http()
      .post('/segments')
      .set('Authorization', auth())
      .send({ name: `LegacySeg-${randomUUID().slice(0, 6)}`, type: 'manual' })
      .expect(201);

    // Two leads at the SAME company in a legacy campaign should still round-robin A then B
    const l1 = await http()
      .post('/leads')
      .set('Authorization', auth())
      .send({ email: 'one@samelegacy.com', firstName: 'One' })
      .expect(201);
    const l2 = await http()
      .post('/leads')
      .set('Authorization', auth())
      .send({ email: 'two@samelegacy.com', firstName: 'Two' })
      .expect(201);

    await http()
      .post(`/segments/${seg.body.id}/members`)
      .set('Authorization', auth())
      .send({ leadIds: [l1.body.id, l2.body.id] })
      .expect(200);

    const camp = await http()
      .post('/campaigns')
      .set('Authorization', auth())
      .send({ name: 'Legacy Rotation Campaign', segmentId: seg.body.id })
      .expect(201);

    await http()
      .post(`/campaigns/${camp.body.id}/steps`)
      .set('Authorization', auth())
      .send({
        templateId,
        delayHours: 0,
        subjectVariants: ['Legacy A', 'Legacy B'],
      })
      .expect(201);

    await http()
      .post(`/campaigns/${camp.body.id}/enroll`)
      .set('Authorization', auth())
      .expect(200);

    await http().post('/sending/tick').set('Authorization', auth()).expect(200);

    await withOrgContext(pool, orgId, async (c) => {
      const sends = await c.query<{
        subject: string;
        variant_index: number;
        experiment_id: string | null;
        variant_id: string | null;
      }>(
        `SELECT subject, variant_index, experiment_id, variant_id
         FROM sent_emails WHERE campaign_id = $1 ORDER BY sent_at ASC`,
        [camp.body.id],
      );
      expect(sends.rows).toHaveLength(2);
      expect(sends.rows.map((r) => r.variant_index).sort()).toEqual([0, 1]);
      expect(sends.rows.map((r) => r.subject).sort()).toEqual([
        'Legacy A',
        'Legacy B',
      ]);
      expect(sends.rows[0].experiment_id).toBeNull();
      expect(sends.rows[0].variant_id).toBeNull();
    });
  });
});
