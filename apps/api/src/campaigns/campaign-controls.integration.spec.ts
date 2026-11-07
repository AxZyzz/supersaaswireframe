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

/** E4 chunk 3 controls: duplicate, pause/resume (halts + resumes delivery), and
 *  schedule (defers enrollment; the worker promotes scheduled -> active when the
 *  first send comes due). */
describe('Campaign controls integration', () => {
  let app: INestApplication;
  let pool: Pool;
  let token: string;
  let orgId: string;
  let userId: string;
  let templateId: string;

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

    const email = `ctrl-${randomUUID().slice(0, 8)}@test.local`;
    const res = await request(app.getHttpServer())
      .post('/auth/signup')
      .send({
        email,
        password: 'ctrl-pass-123',
        name: 'Ctrl T',
        orgName: 'Ctrl Org',
      })
      .expect(201);
    token = res.body.accessToken;
    orgId = res.body.org.id;
    userId = res.body.user.id;

    await request(app.getHttpServer())
      .post('/senders')
      .set('Authorization', `Bearer ${token}`)
      .send({ provider: 'smtp', fromName: 'Rep', fromEmail: 'rep@ctrl.local' })
      .expect(201);
    await verifyAllSenders(app.getHttpServer(), `Bearer ${token}`);
    await request(app.getHttpServer())
      .post('/leads')
      .set('Authorization', `Bearer ${token}`)
      .send({ email: 'lead@ctrl.local', firstName: 'Lee' })
      .expect(201);
    const tpls = await request(app.getHttpServer())
      .get('/templates')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    templateId = tpls.body[0].id;
  });

  afterAll(async () => {
    await withOrgContext(pool, orgId, async (c) => {
      await c.query(`DELETE FROM orgs WHERE id = $1`, [orgId]);
    });
    await pool.query(`DELETE FROM users WHERE id = $1`, [userId]);
    await app.close();
  });

  const auth = () => `Bearer ${token}`;

  async function makeCampaign(name: string): Promise<string> {
    const camp = await request(app.getHttpServer())
      .post('/campaigns')
      .set('Authorization', auth())
      .send({ name })
      .expect(201);
    await request(app.getHttpServer())
      .post(`/campaigns/${camp.body.id}/steps`)
      .set('Authorization', auth())
      .send({ templateId, delayHours: 0, condition: 'always' })
      .expect(201);
    return camp.body.id;
  }

  it('duplicates a campaign into a fresh draft with copied steps and no leads', async () => {
    const id = await makeCampaign('Original');
    const dup = await request(app.getHttpServer())
      .post(`/campaigns/${id}/duplicate`)
      .set('Authorization', auth())
      .expect(201);
    expect(dup.body.name).toBe('Original (copy)');
    expect(dup.body.status).toBe('draft');

    const detail = await request(app.getHttpServer())
      .get(`/campaigns/${dup.body.id}`)
      .set('Authorization', auth())
      .expect(200);
    expect(detail.body.steps.length).toBe(1);
    expect(detail.body.steps[0].template_id).toBe(templateId);

    await withOrgContext(pool, orgId, async (c) => {
      const leads = await c.query(
        `SELECT count(*)::int AS n FROM campaign_leads WHERE campaign_id = $1`,
        [dup.body.id],
      );
      expect(leads.rows[0].n).toBe(0);
    });
  });

  it('pause halts delivery; resume restarts it', async () => {
    const id = await makeCampaign('Pausable');
    await request(app.getHttpServer())
      .post(`/campaigns/${id}/enroll`)
      .set('Authorization', auth())
      .expect(200);

    // pause -> due scan skips it
    const paused = await request(app.getHttpServer())
      .post(`/campaigns/${id}/pause`)
      .set('Authorization', auth())
      .expect(200);
    expect(paused.body.status).toBe('paused');

    let tick = await request(app.getHttpServer())
      .post('/sending/tick')
      .set('Authorization', auth())
      .expect(200);
    expect(tick.body.sent).toBe(0);

    // resume -> now it sends
    const resumed = await request(app.getHttpServer())
      .post(`/campaigns/${id}/resume`)
      .set('Authorization', auth())
      .expect(200);
    expect(resumed.body.status).toBe('active');

    tick = await request(app.getHttpServer())
      .post('/sending/tick')
      .set('Authorization', auth())
      .expect(200);
    expect(tick.body.sent).toBe(1);
  });

  it('rejects resuming a campaign that is not paused', async () => {
    const id = await makeCampaign('NotPaused');
    await request(app.getHttpServer())
      .post(`/campaigns/${id}/resume`)
      .set('Authorization', auth())
      .expect(400);
  });

  it('schedules a future start, then the worker promotes it to active on the first due send', async () => {
    const id = await makeCampaign('Scheduled');
    const future = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    const sched = await request(app.getHttpServer())
      .post(`/campaigns/${id}/schedule`)
      .set('Authorization', auth())
      .send({ scheduledAt: future })
      .expect(200);
    expect(sched.body.status).toBe('scheduled');
    expect(sched.body.enrolled).toBe(1);

    // nothing due yet (pinned to the future)
    let tick = await request(app.getHttpServer())
      .post('/sending/tick')
      .set('Authorization', auth())
      .expect(200);
    expect(tick.body.sent).toBe(0);

    // fast-forward: make the lead due now
    await withOrgContext(pool, orgId, async (c) => {
      await c.query(
        `UPDATE campaign_leads SET next_send_at = now() - interval '1 minute'
         WHERE campaign_id = $1`,
        [id],
      );
    });

    tick = await request(app.getHttpServer())
      .post('/sending/tick')
      .set('Authorization', auth())
      .expect(200);
    expect(tick.body.sent).toBe(1);

    // campaign was promoted scheduled -> active
    const detail = await request(app.getHttpServer())
      .get(`/campaigns/${id}`)
      .set('Authorization', auth())
      .expect(200);
    expect(detail.body.status).toBe('active');
    expect(detail.body.started_at).toBeTruthy();
  });

  it('rejects scheduling in the past', async () => {
    const id = await makeCampaign('PastSched');
    const past = new Date(Date.now() - 60 * 1000).toISOString();
    await request(app.getHttpServer())
      .post(`/campaigns/${id}/schedule`)
      .set('Authorization', auth())
      .send({ scheduledAt: past })
      .expect(400);
  });
});
