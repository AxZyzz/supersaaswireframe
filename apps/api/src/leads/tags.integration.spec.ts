/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return */
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'crypto';
import { Pool } from 'pg';
import request from 'supertest';
import { AppModule } from '../app.module';
import { PG_POOL } from '../db/db.module';
import { withOrgContext } from '../db/tenant-context';
import { DEFAULT_TAGS } from './default-tags';

/** Tags: default seeding, bulk attach/detach, tenant scoping, delete cascade. */
describe('Tags integration', () => {
  let app: INestApplication;
  let pool: Pool;
  const orgs: { token: string; orgId: string; userId: string }[] = [];
  const password = 'tags-pass-123';

  async function signup() {
    const email = `tags-${randomUUID().slice(0, 8)}@test.local`;
    const res = await request(app.getHttpServer())
      .post('/auth/signup')
      .send({ email, password, name: 'Tags T', orgName: 'Tags Org' })
      .expect(201);
    return {
      token: res.body.accessToken,
      orgId: res.body.org.id,
      userId: res.body.user.id,
    };
  }

  async function createLead(i: number, email: string): Promise<string> {
    const res = await request(app.getHttpServer())
      .post('/leads')
      .set('Authorization', auth(i))
      .send({ email })
      .expect(201);
    return res.body.id;
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

  it('seeds default starter tags on signup', async () => {
    const res = await request(app.getHttpServer())
      .get('/tags')
      .set('Authorization', auth(0))
      .expect(200);
    expect(res.body).toHaveLength(DEFAULT_TAGS.length);
    const names = res.body.map((t: any) => t.name);
    for (const t of DEFAULT_TAGS) expect(names).toContain(t.name);
  });

  it('bulk attaches and detaches one tag across many leads', async () => {
    const a = await createLead(0, 'a@bulk.local');
    const b = await createLead(0, 'b@bulk.local');
    const tags = await request(app.getHttpServer())
      .get('/tags')
      .set('Authorization', auth(0))
      .expect(200);
    const tagId = tags.body.find((t: any) => t.name === 'Customer').id;

    const attach = await request(app.getHttpServer())
      .post('/tags/bulk')
      .set('Authorization', auth(0))
      .send({ leadIds: [a, b], tagId, action: 'attach' })
      .expect(200);
    expect(attach.body.attached).toBe(2);

    const filtered = await request(app.getHttpServer())
      .get(`/leads?tagId=${tagId}`)
      .set('Authorization', auth(0))
      .expect(200);
    expect(filtered.body.total).toBe(2);

    const detach = await request(app.getHttpServer())
      .post('/tags/bulk')
      .set('Authorization', auth(0))
      .send({ leadIds: [a, b], tagId, action: 'detach' })
      .expect(200);
    expect(detach.body.detached).toBe(2);

    const after = await request(app.getHttpServer())
      .get(`/leads?tagId=${tagId}`)
      .set('Authorization', auth(0))
      .expect(200);
    expect(after.body.total).toBe(0);
  });

  it('bulk tagging is tenant-scoped (cannot tag another org’s leads)', async () => {
    const mine = await createLead(0, 'scoped@bulk.local');
    const otherTags = await request(app.getHttpServer())
      .get('/tags')
      .set('Authorization', auth(1))
      .expect(200);
    const otherTagId = otherTags.body[0].id;

    // org 1 tries to attach its own tag to org 0's lead id -> matches nothing.
    const res = await request(app.getHttpServer())
      .post('/tags/bulk')
      .set('Authorization', auth(1))
      .send({ leadIds: [mine], tagId: otherTagId, action: 'attach' })
      .expect(200);
    expect(res.body.attached).toBe(0);
  });

  it('deletes a tag and cascades its lead attachments (admin)', async () => {
    const lead = await createLead(0, 'del@bulk.local');
    const tags = await request(app.getHttpServer())
      .get('/tags')
      .set('Authorization', auth(0))
      .expect(200);
    const before = tags.body.length;
    const tagId = tags.body.find((t: any) => t.name === 'Cold').id;

    await request(app.getHttpServer())
      .post('/tags/bulk')
      .set('Authorization', auth(0))
      .send({ leadIds: [lead], tagId, action: 'attach' })
      .expect(200);

    await request(app.getHttpServer())
      .delete(`/tags/${tagId}`)
      .set('Authorization', auth(0))
      .expect(200);

    const detail = await request(app.getHttpServer())
      .get(`/leads/${lead}`)
      .set('Authorization', auth(0))
      .expect(200);
    expect(detail.body.tags).toHaveLength(0); // cascade removed the attachment

    const remaining = await request(app.getHttpServer())
      .get('/tags')
      .set('Authorization', auth(0))
      .expect(200);
    expect(remaining.body.length).toBe(before - 1);
  });
});
