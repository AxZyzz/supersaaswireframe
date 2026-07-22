/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-call */
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'crypto';
import { Pool } from 'pg';
import request from 'supertest';
import { AppModule } from '../app.module';
import { PG_POOL } from '../db/db.module';
import { withOrgContext } from '../db/tenant-context';

/** Duplicate detection + merge over real HTTP + live DB. */
describe('Lead merge integration', () => {
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
    const email = `merge-${randomUUID().slice(0, 8)}@test.local`;
    const res = await request(app.getHttpServer())
      .post('/auth/signup')
      .send({ email, password: 'merge-pass-1', name: 'M', orgName: 'M Org' })
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

  const auth = `Bearer `;
  const mk = (body: object) =>
    request(app.getHttpServer())
      .post('/leads')
      .set('Authorization', auth + token)
      .send(body)
      .expect(201);

  it('detects a duplicate group and merges, consolidating tag + notes', async () => {
    // Two "Dana Scully @ FBI" leads — same name+company, different emails.
    const a = await mk({
      email: 'dana@fbi.gov',
      firstName: 'Dana',
      lastName: 'Scully',
      company: 'FBI',
      score: 'hot',
    });
    const b = await mk({
      email: 'd.scully@fbi.gov',
      firstName: 'Dana',
      lastName: 'Scully',
      company: 'FBI',
      phone: '555-0100',
    });
    const primaryId = a.body.id;
    const dupId = b.body.id;

    // note + tag on the duplicate → must survive the merge
    await request(app.getHttpServer())
      .post(`/leads/${dupId}/notes`)
      .set('Authorization', auth + token)
      .send({ body: 'Met at conference' })
      .expect(201);
    const tag = await request(app.getHttpServer())
      .post('/tags')
      .set('Authorization', auth + token)
      .send({ name: 'Conference' })
      .expect(201);
    await request(app.getHttpServer())
      .post(`/leads/${dupId}/tags`)
      .set('Authorization', auth + token)
      .send({ tagId: tag.body.id })
      .expect(200);

    // detection sees the pair
    const dups = await request(app.getHttpServer())
      .get('/leads/duplicates')
      .set('Authorization', auth + token)
      .expect(200);
    expect(dups.body).toHaveLength(1);
    expect(dups.body[0].count).toBe(2);

    // merge dup into primary
    const merged = await request(app.getHttpServer())
      .post('/leads/merge')
      .set('Authorization', auth + token)
      .send({ primaryId, mergeIds: [dupId] })
      .expect(200);
    expect(merged.body.merged).toBe(1);

    // dup is gone; only primary remains
    const list = await request(app.getHttpServer())
      .get('/leads')
      .set('Authorization', auth + token)
      .expect(200);
    expect(list.body.total).toBe(1);

    // primary absorbed the phone (it had none), the note, the tag, a merged event
    const detail = await request(app.getHttpServer())
      .get(`/leads/${primaryId}`)
      .set('Authorization', auth + token)
      .expect(200);
    expect(detail.body.phone).toBe('555-0100');
    expect(detail.body.notes).toHaveLength(1);
    expect(detail.body.tags.map((t: { name: string }) => t.name)).toContain(
      'Conference',
    );
    expect(detail.body.events.map((e: { type: string }) => e.type)).toContain(
      'merged',
    );

    // no duplicates remain
    const after = await request(app.getHttpServer())
      .get('/leads/duplicates')
      .set('Authorization', auth + token)
      .expect(200);
    expect(after.body).toHaveLength(0);
  });

  it('agent cannot merge (admin/manager only)', async () => {
    // sign up a second user, drop them into this org as agent
    const agentEmail = `magent-${randomUUID().slice(0, 8)}@test.local`;
    const s = await request(app.getHttpServer())
      .post('/auth/signup')
      .send({
        email: agentEmail,
        password: 'merge-pass-1',
        name: 'MA',
        orgName: 'MA Own',
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
      .set('Authorization', auth + s.body.accessToken)
      .send({ orgId })
      .expect(200);
    await request(app.getHttpServer())
      .post('/leads/merge')
      .set('Authorization', auth + sw.body.accessToken)
      .send({ primaryId: randomUUID(), mergeIds: [randomUUID()] })
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
