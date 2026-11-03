/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return */
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'crypto';
import { Pool } from 'pg';
import request from 'supertest';
import { AppModule } from '../../app.module';
import { PG_POOL } from '../../db/db.module';
import { withOrgContext } from '../../db/tenant-context';

/** Segments end to end: smart-rule refresh via the BullMQ worker + manual
 *  membership + rule validation + RBAC. Requires Postgres + Redis. */
describe('Segments integration', () => {
  let app: INestApplication;
  let pool: Pool;
  let token: string;
  let orgId: string;
  let userId: string;

  const H = () => ({ Authorization: `Bearer ${token}` });

  const mk = (body: object) =>
    request(app.getHttpServer()).post('/leads').set(H()).send(body).expect(201);

  // Poll a smart segment until the worker has refreshed it.
  const waitRefreshed = async (id: string) => {
    for (let i = 0; i < 60; i++) {
      const res = await request(app.getHttpServer())
        .get(`/segments/${id}`)
        .set(H())
        .expect(200);
      if (res.body.last_refreshed_at) return res.body;
      await new Promise((r) => setTimeout(r, 200));
    }
    throw new Error('segment did not refresh in time');
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
    const email = `seg-${randomUUID().slice(0, 8)}@test.local`;
    const res = await request(app.getHttpServer())
      .post('/auth/signup')
      .send({ email, password: 'seg-pass-1', name: 'S', orgName: 'Seg Org' })
      .expect(201);
    token = res.body.accessToken;
    orgId = res.body.org.id;
    userId = res.body.user.id;

    // Seed leads: 2 hot, 1 warm (one hot also at "Acme").
    await mk({
      email: 'h1@acme.com',
      firstName: 'H1',
      company: 'Acme',
      score: 'hot',
    });
    await mk({
      email: 'h2@globex.com',
      firstName: 'H2',
      company: 'Globex',
      score: 'hot',
    });
    await mk({
      email: 'w1@acme.com',
      firstName: 'W1',
      company: 'Acme',
      score: 'warm',
    });
  });

  afterAll(async () => {
    await withOrgContext(pool, orgId, async (c) => {
      await c.query(`DELETE FROM orgs WHERE id = $1`, [orgId]);
    });
    await pool.query(`DELETE FROM users WHERE id = $1`, [userId]);
    await app.close();
  });

  it('smart segment materializes members matching the rule (score=hot)', async () => {
    const seg = await request(app.getHttpServer())
      .post('/segments')
      .set(H())
      .send({
        name: 'Hot leads',
        type: 'smart',
        rules: {
          match: 'all',
          conditions: [{ field: 'score', op: 'eq', value: 'hot' }],
        },
      })
      .expect(201);
    const refreshed = await waitRefreshed(seg.body.id);
    expect(refreshed.member_count).toBe(2);

    const members = await request(app.getHttpServer())
      .get(`/segments/${seg.body.id}/leads`)
      .set(H())
      .expect(200);
    expect(members.body.total).toBe(2);
    expect(
      members.body.data.every((l: { score: string }) => l.score === 'hot'),
    ).toBe(true);
  });

  it('narrows membership when a rule is added (score=hot AND company~Acme)', async () => {
    const seg = await request(app.getHttpServer())
      .post('/segments')
      .set(H())
      .send({
        name: 'Hot at Acme',
        type: 'smart',
        rules: {
          match: 'all',
          conditions: [
            { field: 'score', op: 'eq', value: 'hot' },
            { field: 'company', op: 'contains', value: 'Acme' },
          ],
        },
      })
      .expect(201);
    const refreshed = await waitRefreshed(seg.body.id);
    expect(refreshed.member_count).toBe(1); // only H1 (hot + Acme)
  });

  it('engagement rules: opened / never opened / replied / never emailed (T2.7)', async () => {
    // h1 + h2 emailed; h1 opened; h2 replied; w1 never emailed.
    await withOrgContext(pool, orgId, async (c) => {
      const leads = await c.query<{ id: string; email: string }>(
        `SELECT id, email FROM leads`,
      );
      const id = (e: string) => leads.rows.find((l) => l.email === e)!.id;
      for (const e of ['h1@acme.com', 'h2@globex.com']) {
        await c.query(
          `INSERT INTO sent_emails (org_id, lead_id, to_email) VALUES ($1, $2, $3)`,
          [orgId, id(e), e],
        );
      }
      await c.query(
        `INSERT INTO email_events (org_id, lead_id, type) VALUES ($1, $2, 'open'), ($1, $3, 'reply')`,
        [orgId, id('h1@acme.com'), id('h2@globex.com')],
      );
    });

    const count = async (op: string) => {
      const seg = await request(app.getHttpServer())
        .post('/segments')
        .set(H())
        .send({
          name: `eng ${op}`,
          type: 'smart',
          rules: { match: 'all', conditions: [{ field: 'engagement', op }] },
        })
        .expect(201);
      return (await waitRefreshed(seg.body.id)).member_count;
    };
    expect(await count('emailed')).toBe(2);
    expect(await count('never_emailed')).toBe(1);
    expect(await count('opened')).toBe(1);
    expect(await count('never_opened')).toBe(1); // h2: emailed, no open
    expect(await count('replied')).toBe(1);
    expect(await count('not_replied')).toBe(1); // h1
    expect(await count('clicked')).toBe(0);
  });

  it('manual segment: add and remove members explicitly', async () => {
    const leads = await request(app.getHttpServer())
      .get('/leads')
      .set(H())
      .expect(200);
    const ids = leads.body.data.map((l: { id: string }) => l.id).slice(0, 2);

    const seg = await request(app.getHttpServer())
      .post('/segments')
      .set(H())
      .send({ name: 'My picks', type: 'manual' })
      .expect(201);

    const added = await request(app.getHttpServer())
      .post(`/segments/${seg.body.id}/members`)
      .set(H())
      .send({ leadIds: ids })
      .expect(200);
    expect(added.body.memberCount).toBe(2);

    await request(app.getHttpServer())
      .delete(`/segments/${seg.body.id}/members/${ids[0]}`)
      .set(H())
      .expect(200);
    const after = await request(app.getHttpServer())
      .get(`/segments/${seg.body.id}`)
      .set(H())
      .expect(200);
    expect(after.body.member_count).toBe(1);
  });

  it('rejects an invalid rule field with 400', async () => {
    await request(app.getHttpServer())
      .post('/segments')
      .set(H())
      .send({
        name: 'Bad',
        type: 'smart',
        rules: {
          match: 'all',
          conditions: [{ field: 'nonsense', op: 'eq', value: 'x' }],
        },
      })
      .expect(400);
  });

  it('agent cannot create a segment (admin/manager only)', async () => {
    const s = await request(app.getHttpServer())
      .post('/auth/signup')
      .send({
        email: `sa-${randomUUID().slice(0, 8)}@test.local`,
        password: 'seg-pass-1',
        name: 'SA',
        orgName: 'SA Own',
      })
      .expect(201);
    const agentUserId = s.body.user.id;
    const agentOwn = s.body.org.id;
    await withOrgContext(pool, orgId, async (c) => {
      await c.query(
        `INSERT INTO memberships (org_id, user_id, role) VALUES ($1, $2, 'agent')`,
        [orgId, agentUserId],
      );
    });
    const sw = await request(app.getHttpServer())
      .post('/auth/switch-org')
      .set('Authorization', `Bearer ${s.body.accessToken}`)
      .send({ orgId })
      .expect(200);
    await request(app.getHttpServer())
      .post('/segments')
      .set('Authorization', `Bearer ${sw.body.accessToken}`)
      .send({ name: 'nope', type: 'manual' })
      .expect(403);

    await withOrgContext(pool, agentOwn, async (c) => {
      await c.query(`DELETE FROM orgs WHERE id = $1`, [agentOwn]);
    });
    await withOrgContext(pool, orgId, async (c) => {
      await c.query(`DELETE FROM memberships WHERE user_id = $1`, [
        agentUserId,
      ]);
    });
    await pool.query(`DELETE FROM users WHERE id = $1`, [agentUserId]);
  });
});
