/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-call */
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'crypto';
import { Pool } from 'pg';
import request from 'supertest';
import { AppModule } from '../app.module';
import { PG_POOL } from '../db/db.module';
import { withOrgContext } from '../db/tenant-context';

/** Campaign data model: CRUD, steps (delay/condition/A-B variants), audience
 *  count, per-lead enrollment, tenant isolation. */
describe('Campaigns integration', () => {
  let app: INestApplication;
  let pool: Pool;
  const orgs: { token: string; orgId: string; userId: string }[] = [];
  const password = 'camp-pass-123';

  async function signup() {
    const email = `camp-${randomUUID().slice(0, 8)}@test.local`;
    const res = await request(app.getHttpServer())
      .post('/auth/signup')
      .send({ email, password, name: 'Camp T', orgName: 'Camp Org' })
      .expect(201);
    return {
      token: res.body.accessToken,
      orgId: res.body.org.id,
      userId: res.body.user.id,
    };
  }

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
    orgs.push(await signup(), await signup());
  });

  afterAll(async () => {
    for (const o of orgs) {
      await withOrgContext(pool, o.orgId, async (c) => {
        await c.query(`DELETE FROM orgs WHERE id = $1`, [o.orgId]);
      });
      await pool.query(`DELETE FROM users WHERE id = $1`, [o.userId]);
    }
    await app.close();
  });

  const auth = (i: number) => `Bearer ${orgs[i].token}`;
  let campaignId: string;
  let templateId: string;

  it('creates a campaign (draft)', async () => {
    const res = await request(app.getHttpServer())
      .post('/campaigns')
      .set('Authorization', auth(0))
      .send({ name: 'Q3 outreach' })
      .expect(201);
    expect(res.body.status).toBe('draft');
    campaignId = res.body.id;

    // grab a seeded template to reference from a step
    const tpls = await request(app.getHttpServer())
      .get('/templates')
      .set('Authorization', auth(0))
      .expect(200);
    templateId = tpls.body[0].id;
  });

  it('adds ordered steps with delay, condition and A/B variants', async () => {
    const s1 = await request(app.getHttpServer())
      .post(`/campaigns/${campaignId}/steps`)
      .set('Authorization', auth(0))
      .send({ templateId, delayHours: 0, condition: 'always' })
      .expect(201);
    expect(s1.body.step_order).toBe(0);

    const s2 = await request(app.getHttpServer())
      .post(`/campaigns/${campaignId}/steps`)
      .set('Authorization', auth(0))
      .send({
        templateId,
        delayHours: 48,
        condition: 'opened_no_reply',
        subjectVariants: ['Following up', 'Quick nudge'],
      })
      .expect(201);
    expect(s2.body.step_order).toBe(1);
    expect(s2.body.delay_hours).toBe(48);
    expect(s2.body.condition).toBe('opened_no_reply');
    expect(s2.body.subject_variants).toEqual(['Following up', 'Quick nudge']);

    const full = await request(app.getHttpServer())
      .get(`/campaigns/${campaignId}`)
      .set('Authorization', auth(0))
      .expect(200);
    expect(full.body.steps).toHaveLength(2);
    expect(full.body.steps[0].step_order).toBe(0);
    expect(full.body.steps[1].step_order).toBe(1);
  });

  it('rejects an invalid condition via ValidationPipe', async () => {
    await request(app.getHttpServer())
      .post(`/campaigns/${campaignId}/steps`)
      .set('Authorization', auth(0))
      .send({ condition: 'whenever' })
      .expect(400);
  });

  it('counts the audience (all org leads when no segment)', async () => {
    for (const e of ['a@camp.local', 'b@camp.local']) {
      await request(app.getHttpServer())
        .post('/leads')
        .set('Authorization', auth(0))
        .send({ email: e })
        .expect(201);
    }
    const res = await request(app.getHttpServer())
      .get(`/campaigns/${campaignId}/audience`)
      .set('Authorization', auth(0))
      .expect(200);
    expect(res.body.count).toBe(2);
  });

  it('enrolls leads into per-lead state and activates the campaign', async () => {
    const res = await request(app.getHttpServer())
      .post(`/campaigns/${campaignId}/enroll`)
      .set('Authorization', auth(0))
      .expect(200);
    expect(res.body.enrolled).toBe(2);

    const camp = await request(app.getHttpServer())
      .get(`/campaigns/${campaignId}`)
      .set('Authorization', auth(0))
      .expect(200);
    expect(camp.body.status).toBe('active');
    expect(camp.body.started_at).toBeTruthy();

    // re-enroll is idempotent (ON CONFLICT DO NOTHING)
    const again = await request(app.getHttpServer())
      .post(`/campaigns/${campaignId}/enroll`)
      .set('Authorization', auth(0))
      .expect(200);
    expect(again.body.enrolled).toBe(0);
  });

  it('lists campaigns with step + lead counts', async () => {
    const res = await request(app.getHttpServer())
      .get('/campaigns')
      .set('Authorization', auth(0))
      .expect(200);
    const c = res.body.find((x: any) => x.id === campaignId);
    expect(c.steps).toBe(2);
    expect(c.leads).toBe(2);
  });

  it('archives a campaign and blocks re-enroll', async () => {
    await request(app.getHttpServer())
      .post(`/campaigns/${campaignId}/archive`)
      .set('Authorization', auth(0))
      .expect(200);
    const camp = await request(app.getHttpServer())
      .get(`/campaigns/${campaignId}`)
      .set('Authorization', auth(0))
      .expect(200);
    expect(camp.body.status).toBe('archived');

    await request(app.getHttpServer())
      .post(`/campaigns/${campaignId}/enroll`)
      .set('Authorization', auth(0))
      .expect(400);
  });

  it('isolates campaigns between orgs', async () => {
    const list = await request(app.getHttpServer())
      .get('/campaigns')
      .set('Authorization', auth(1))
      .expect(200);
    expect(list.body).toHaveLength(0);

    await request(app.getHttpServer())
      .get(`/campaigns/${campaignId}`)
      .set('Authorization', auth(1))
      .expect(404);
  });
});
