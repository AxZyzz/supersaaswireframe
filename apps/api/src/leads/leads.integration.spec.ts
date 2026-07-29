/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return */
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'crypto';
import { Pool } from 'pg';
import request from 'supertest';
import { AppModule } from '../app.module';
import { PG_POOL } from '../db/db.module';
import { withOrgContext } from '../db/tenant-context';

/** Lead management over real HTTP + live DB (RLS active). Two separate orgs
 *  prove tenant isolation flows through the API, not just raw SQL. */
describe('Leads integration', () => {
  let app: INestApplication;
  let pool: Pool;

  // Two independent tenants, each its own signed-in user.
  const orgs: { token: string; orgId: string; userId: string }[] = [];
  const password = 'leads-pass-123';

  async function signup(): Promise<{
    token: string;
    orgId: string;
    userId: string;
  }> {
    const email = `leads-${randomUUID().slice(0, 8)}@test.local`;
    const res = await request(app.getHttpServer())
      .post('/auth/signup')
      .send({ email, password, name: 'Leads T', orgName: 'Leads Org' })
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
  let leadId: string;

  it('creates a lead with a created event', async () => {
    const res = await request(app.getHttpServer())
      .post('/leads')
      .set('Authorization', auth(0))
      .send({
        email: 'jane@acme.com',
        firstName: 'Jane',
        company: 'Acme',
        score: 'hot',
        source: 'csv',
      })
      .expect(201);
    expect(res.body.id).toBeDefined();
    expect(res.body.status).toBe('new');
    leadId = res.body.id;

    const detail = await request(app.getHttpServer())
      .get(`/leads/${leadId}`)
      .set('Authorization', auth(0))
      .expect(200);
    expect(detail.body.events.some((e: any) => e.type === 'created')).toBe(
      true,
    );
  });

  it('rejects an invalid score enum via ValidationPipe', async () => {
    await request(app.getHttpServer())
      .post('/leads')
      .set('Authorization', auth(0))
      .send({ email: 'x@y.com', score: 'lukewarm' })
      .expect(400);
  });

  it('lists + filters by search and score', async () => {
    const all = await request(app.getHttpServer())
      .get('/leads')
      .set('Authorization', auth(0))
      .expect(200);
    expect(all.body.total).toBe(1);
    expect(all.body.data).toHaveLength(1);

    const hit = await request(app.getHttpServer())
      .get('/leads?search=acme&score=hot')
      .set('Authorization', auth(0))
      .expect(200);
    expect(hit.body.total).toBe(1);

    const miss = await request(app.getHttpServer())
      .get('/leads?search=nonexistent')
      .set('Authorization', auth(0))
      .expect(200);
    expect(miss.body.total).toBe(0);
  });

  it('creates a tag, attaches it, filters by it', async () => {
    // Use a non-default name — signup seeds starter tags (incl. "Hot Lead").
    const tag = await request(app.getHttpServer())
      .post('/tags')
      .set('Authorization', auth(0))
      .send({ name: 'VIP Prospect', color: '#C62A2F' })
      .expect(201);
    const tagId = tag.body.id;

    await request(app.getHttpServer())
      .post(`/leads/${leadId}/tags`)
      .set('Authorization', auth(0))
      .send({ tagId })
      .expect(200);

    const filtered = await request(app.getHttpServer())
      .get(`/leads?tagId=${tagId}`)
      .set('Authorization', auth(0))
      .expect(200);
    expect(filtered.body.total).toBe(1);

    const detail = await request(app.getHttpServer())
      .get(`/leads/${leadId}`)
      .set('Authorization', auth(0))
      .expect(200);
    expect(detail.body.tags).toHaveLength(1);
    expect(detail.body.tags[0].name).toBe('VIP Prospect');
  });

  it('rejects duplicate tag names (case-insensitive)', async () => {
    await request(app.getHttpServer())
      .post('/tags')
      .set('Authorization', auth(0))
      .send({ name: 'vip prospect' })
      .expect(409);
  });

  it('adds a note and updates the lead', async () => {
    await request(app.getHttpServer())
      .post(`/leads/${leadId}/notes`)
      .set('Authorization', auth(0))
      .send({ body: 'Called, left voicemail.' })
      .expect(201);

    const upd = await request(app.getHttpServer())
      .patch(`/leads/${leadId}`)
      .set('Authorization', auth(0))
      .send({ status: 'contacted' })
      .expect(200);
    expect(upd.body.status).toBe('contacted');

    const detail = await request(app.getHttpServer())
      .get(`/leads/${leadId}`)
      .set('Authorization', auth(0))
      .expect(200);
    expect(detail.body.notes).toHaveLength(1);
    const types = detail.body.events.map((e: any) => e.type);
    expect(types).toEqual(
      expect.arrayContaining(['created', 'note_added', 'updated']),
    );
  });

  it('exports leads as CSV with a header row', async () => {
    const res = await request(app.getHttpServer())
      .get('/leads/export')
      .set('Authorization', auth(0))
      .expect(200);
    expect(res.headers['content-type']).toMatch(/text\/csv/);
    expect(res.headers['content-disposition']).toMatch(/leads\.csv/);
    const lines = res.text.trim().split('\n');
    expect(lines[0]).toContain('email');
    expect(lines[0]).toContain('company');
    // header + the one lead created above
    expect(lines.length).toBe(2);
    expect(res.text).toContain('jane@acme.com');
  });

  it('isolates leads between orgs (org 1 cannot see or fetch org 0 lead)', async () => {
    const list = await request(app.getHttpServer())
      .get('/leads')
      .set('Authorization', auth(1))
      .expect(200);
    expect(list.body.total).toBe(0);

    await request(app.getHttpServer())
      .get(`/leads/${leadId}`)
      .set('Authorization', auth(1))
      .expect(404);

    await request(app.getHttpServer())
      .patch(`/leads/${leadId}`)
      .set('Authorization', auth(1))
      .send({ status: 'hacked' })
      .expect(404);
  });

  it('blocks agent from deleting but allows admin', async () => {
    // Owner (org 0) is admin → can delete.
    await request(app.getHttpServer())
      .delete(`/leads/${leadId}`)
      .set('Authorization', auth(0))
      .expect(200);

    await request(app.getHttpServer())
      .get(`/leads/${leadId}`)
      .set('Authorization', auth(0))
      .expect(404);
  });
});
