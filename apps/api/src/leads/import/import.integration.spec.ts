/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-return */
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'crypto';
import { Pool } from 'pg';
import request from 'supertest';
import { AppModule } from '../../app.module';
import { PG_POOL } from '../../db/db.module';
import { withOrgContext } from '../../db/tenant-context';

/**
 * CSV import end to end: HTTP upload → BullMQ worker → DB. Exercises insert,
 * case-insensitive dedupe (skip + update modes), and per-row error capture.
 * Requires Redis (docker compose) in addition to Postgres.
 */
describe('CSV import integration', () => {
  let app: INestApplication;
  let pool: Pool;
  let token: string;
  let orgId: string;
  let userId: string;

  const poll = async (jobId: string) => {
    for (let i = 0; i < 60; i++) {
      const res = await request(app.getHttpServer())
        .get(`/leads/import/${jobId}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      if (res.body.status === 'completed' || res.body.status === 'failed') {
        return res.body;
      }
      await new Promise((r) => setTimeout(r, 250));
    }
    throw new Error('import did not finish in time');
  };

  const upload = (csv: string, mapping: object, onDuplicate = 'skip') =>
    request(app.getHttpServer())
      .post('/leads/import')
      .set('Authorization', `Bearer ${token}`)
      .field('mapping', JSON.stringify(mapping))
      .field('onDuplicate', onDuplicate)
      .attach('file', Buffer.from(csv), 'leads.csv');

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

    const email = `import-${randomUUID().slice(0, 8)}@test.local`;
    const res = await request(app.getHttpServer())
      .post('/auth/signup')
      .send({
        email,
        password: 'import-pass-1',
        name: 'Imp',
        orgName: 'Imp Org',
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

  const MAPPING = {
    Email: 'email',
    First: 'firstName',
    Company: 'company',
    Score: 'score',
  };

  it('imports rows, skips a blank row, records the error', async () => {
    const csv = [
      'Email,First,Company,Score',
      'alice@acme.com,Alice,Acme,hot',
      'bob@globex.com,Bob,Globex,warm',
      ',,,', // blank identity → skipped with error
    ].join('\n');

    const start = await upload(csv, MAPPING).expect(201);
    const result = await poll(start.body.jobId);

    expect(result.status).toBe('completed');
    expect(result.total).toBe(3);
    expect(result.imported).toBe(2);
    expect(result.skipped).toBe(1);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].reason).toMatch(/no email/i);

    const list = await request(app.getHttpServer())
      .get('/leads')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(list.body.total).toBe(2);
  });

  it('dedupes on re-import (skip mode) — case-insensitive', async () => {
    const csv = ['Email,First,Company', 'ALICE@ACME.COM,Alice2,Acme2'].join(
      '\n',
    );
    const start = await upload(csv, {
      Email: 'email',
      First: 'firstName',
      Company: 'company',
    }).expect(201);
    const result = await poll(start.body.jobId);
    expect(result.imported).toBe(0);
    expect(result.skipped).toBe(1);

    const list = await request(app.getHttpServer())
      .get('/leads')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(list.body.total).toBe(2); // unchanged
  });

  it('updates existing on re-import (update mode)', async () => {
    const csv = ['Email,Company', 'alice@acme.com,NewCo'].join('\n');
    const start = await upload(
      csv,
      { Email: 'email', Company: 'company' },
      'update',
    ).expect(201);
    const result = await poll(start.body.jobId);
    expect(result.updated).toBe(1);
    expect(result.imported).toBe(0);

    const list = await request(app.getHttpServer())
      .get('/leads?search=NewCo')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(list.body.total).toBe(1);
  });

  it('rejects a mapping without an email column', async () => {
    await upload('First\nBob', { First: 'firstName' }).expect(400);
  });
});
