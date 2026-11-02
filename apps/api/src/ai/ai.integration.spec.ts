/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument */
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'crypto';
import { Pool } from 'pg';
import request from 'supertest';
import { AppModule } from '../app.module';
import { PG_POOL } from '../db/db.module';
import { withOrgContext } from '../db/tenant-context';

/** E6 chunk 2: Knowledge Base CRUD, AI sequence generation (mock driver), and
 *  approve→draft campaign creation. Real generation content needs Bedrock creds;
 *  here the mock provider exercises the wiring end-to-end. */
describe('AI content integration', () => {
  let app: INestApplication;
  let pool: Pool;
  let token: string;
  let orgId: string;
  let userId: string;

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

    const email = `ai-${randomUUID().slice(0, 8)}@test.local`;
    const res = await request(app.getHttpServer())
      .post('/auth/signup')
      .send({ email, password: 'ai-pass-123', name: 'AI T', orgName: 'AI Org' })
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

  it('upserts and reads the knowledge base', async () => {
    await request(app.getHttpServer())
      .put('/ai/knowledge')
      .set('Authorization', auth())
      .send({ offer: 'AI cold email', audience: 'B2B SaaS founders' })
      .expect(200);

    const get1 = await request(app.getHttpServer())
      .get('/ai/knowledge')
      .set('Authorization', auth())
      .expect(200);
    expect(get1.body.offer).toBe('AI cold email');
    expect(get1.body.audience).toBe('B2B SaaS founders');

    // upsert overwrites, single row per org
    await request(app.getHttpServer())
      .put('/ai/knowledge')
      .set('Authorization', auth())
      .send({ offer: 'Done-for-you outreach' })
      .expect(200);
    const get2 = await request(app.getHttpServer())
      .get('/ai/knowledge')
      .set('Authorization', auth())
      .expect(200);
    expect(get2.body.offer).toBe('Done-for-you outreach');

    await withOrgContext(pool, orgId, async (c) => {
      const n = await c.query(
        `SELECT count(*)::int AS n FROM org_knowledge WHERE org_id = $1`,
        [orgId],
      );
      expect(n.rows[0].n).toBe(1);
    });
  });

  it('generates a sequence (mock) and logs token usage', async () => {
    const res = await request(app.getHttpServer())
      .post('/ai/generate-sequence')
      .set('Authorization', auth())
      .send({ goal: 'Book demos with SaaS founders', steps: 3 })
      .expect(200);
    expect(res.body.model).toBe('mock');
    // a usable draft of the requested length, first step immediate
    expect(res.body.steps).toHaveLength(3);
    expect(res.body.steps[0].delayHours).toBe(0);
    expect(res.body.steps[0].subject).toBeTruthy();
    expect(res.body.steps[2].delayHours).toBeGreaterThan(0);

    // usage logging is fire-and-forget — poll briefly for the row
    let logged = 0;
    for (let i = 0; i < 20 && logged === 0; i++) {
      await withOrgContext(pool, orgId, async (c) => {
        const r = await c.query(
          `SELECT count(*)::int AS n FROM ai_usage
           WHERE org_id = $1 AND feature = 'sequence-gen'`,
          [orgId],
        );
        logged = r.rows[0].n;
      });
      if (logged === 0) await new Promise((r) => setTimeout(r, 100));
    }
    expect(logged).toBeGreaterThanOrEqual(1);
  });

  it('approves a sequence into a draft campaign with a template per step', async () => {
    const create = await request(app.getHttpServer())
      .post('/ai/campaigns/from-sequence')
      .set('Authorization', auth())
      .send({
        name: 'AI Draft',
        steps: [
          { subject: 'Hi {first_name}', body: 'Intro body', delayHours: 0 },
          { subject: 'Following up', body: 'Follow-up body', delayHours: 48 },
        ],
      })
      .expect(201);
    expect(create.body.status).toBe('draft');
    expect(create.body.steps).toBe(2);
    const campaignId = create.body.id;

    const detail = await request(app.getHttpServer())
      .get(`/campaigns/${campaignId}`)
      .set('Authorization', auth())
      .expect(200);
    expect(detail.body.steps.length).toBe(2);
    expect(detail.body.steps[0].template_id).toBeTruthy();
    expect(detail.body.steps[1].delay_hours).toBe(48);

    await withOrgContext(pool, orgId, async (c) => {
      const tpls = await c.query(
        `SELECT count(*)::int AS n FROM templates WHERE name LIKE 'AI Draft — step %'`,
      );
      expect(tpls.rows[0].n).toBe(2);
    });
  });

  it('rejects a from-sequence with no steps', async () => {
    await request(app.getHttpServer())
      .post('/ai/campaigns/from-sequence')
      .set('Authorization', auth())
      .send({ name: 'Empty', steps: [] })
      .expect(400);
  });
});
