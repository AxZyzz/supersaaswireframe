/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return */
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'crypto';
import { Pool } from 'pg';
import request from 'supertest';
import { AppModule } from '../app.module';
import { PG_POOL } from '../db/db.module';
import { withOrgContext } from '../db/tenant-context';

/** T2.3: per-workspace lead status manager. */
describe('Lead statuses integration', () => {
  let app: INestApplication;
  let pool: Pool;
  let token: string;
  let orgId: string;
  let userId: string;
  const H = () => ({ Authorization: `Bearer ${token}` });
  const http = () => request(app.getHttpServer());

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
    const res = await http()
      .post('/auth/signup')
      .send({
        email: `ls-${randomUUID().slice(0, 8)}@test.local`,
        password: 'ls-pass-123',
        name: 'LS',
        orgName: 'LS Org',
      })
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

  const statusOf = async (email: string) =>
    (await http().get(`/leads?search=${email}`).set(H())).body.data[0].status;

  it('starts with the six system statuses and live counts', async () => {
    await http()
      .post('/leads')
      .set(H())
      .send({ email: 'a@ls.local' })
      .expect(201);
    const r = await http().get('/lead-statuses').set(H()).expect(200);
    expect(r.body.map((s: { name: string }) => s.name)).toEqual([
      'new',
      'contacted',
      'replied',
      'interested',
      'converted',
      'lost',
    ]);
    expect(r.body.every((s: { system: boolean }) => s.system)).toBe(true);
    expect(r.body[0].count).toBe(1);
  });

  it('adds, reorders and recolours; refuses dropping system statuses', async () => {
    const base = (await http().get('/lead-statuses').set(H())).body.map(
      (s: { name: string; color: string }) => ({
        name: s.name,
        color: s.color,
      }),
    );
    const next = [{ name: 'Meeting Booked', color: 'amber' }, ...base];
    const r = await http()
      .put('/lead-statuses')
      .set(H())
      .send({ statuses: next })
      .expect(200);
    expect(r.body[0]).toMatchObject({
      name: 'meeting booked',
      color: 'amber',
      system: false,
    });

    await http()
      .put('/lead-statuses')
      .set(H())
      .send({
        statuses: next.filter((s: { name: string }) => s.name !== 'lost'),
      })
      .expect(400);
    await http()
      .put('/lead-statuses')
      .set(H())
      .send({ statuses: [...next, { name: 'x', color: 'neon' }] })
      .expect(400);
  });

  it('renames a custom status and migrates its leads', async () => {
    await http()
      .post('/leads')
      .set(H())
      .send({ email: 'b@ls.local', status: 'meeting booked' })
      .expect(201);
    const r = await http()
      .post('/lead-statuses/rename')
      .set(H())
      .send({ from: 'meeting booked', to: 'demo scheduled' })
      .expect(201);
    expect(r.body.leadsMoved).toBe(1);
    expect(await statusOf('b@ls.local')).toBe('demo scheduled');

    await http()
      .post('/lead-statuses/rename')
      .set(H())
      .send({ from: 'converted', to: 'won' })
      .expect(400);
  });

  it('in-use custom statuses are deleted only with a replacement', async () => {
    const list = (await http().get('/lead-statuses').set(H())).body.map(
      (s: { name: string; color: string }) => ({
        name: s.name,
        color: s.color,
      }),
    );
    await http()
      .put('/lead-statuses')
      .set(H())
      .send({
        statuses: list.filter(
          (s: { name: string }) => s.name !== 'demo scheduled',
        ),
      })
      .expect(400);

    const del = await http()
      .delete('/lead-statuses/demo%20scheduled?moveTo=interested')
      .set(H())
      .expect(200);
    expect(del.body.leadsMoved).toBe(1);
    expect(await statusOf('b@ls.local')).toBe('interested');
    await http().delete('/lead-statuses/new').set(H()).expect(400);
  });
});
