/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument */
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'crypto';
import { Pool } from 'pg';
import request from 'supertest';
import { AppModule } from '../app.module';
import { PG_POOL } from '../db/db.module';
import { withOrgContext } from '../db/tenant-context';
import { DEFAULT_TEMPLATES } from './default-templates';

/** Templates: seeding, CRUD, folders, duplicate, render preview, test-send
 *  through the mock provider, and tenant isolation. */
describe('Templates integration', () => {
  let app: INestApplication;
  let pool: Pool;
  const orgs: { token: string; orgId: string; userId: string }[] = [];
  const password = 'tmpl-pass-123';

  async function signup() {
    const email = `tmpl-${randomUUID().slice(0, 8)}@test.local`;
    const res = await request(app.getHttpServer())
      .post('/auth/signup')
      .send({ email, password, name: 'Tmpl T', orgName: 'Tmpl Org' })
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
  let templateId: string;

  it('seeds default starter templates on signup', async () => {
    const res = await request(app.getHttpServer())
      .get('/templates')
      .set('Authorization', auth(0))
      .expect(200);
    expect(res.body).toHaveLength(DEFAULT_TEMPLATES.length);
    templateId = res.body[0].id;
  });

  it('creates, updates, and gets a template', async () => {
    const created = await request(app.getHttpServer())
      .post('/templates')
      .set('Authorization', auth(0))
      .send({
        name: 'My template',
        subject: 'Hi {first_name|there}',
        bodyHtml: '<p>Hello {first_name|friend} at {business_name}</p>',
      })
      .expect(201);
    const id = created.body.id;
    expect(created.body.subject).toBe('Hi {first_name|there}');

    const upd = await request(app.getHttpServer())
      .patch(`/templates/${id}`)
      .set('Authorization', auth(0))
      .send({ name: 'Renamed' })
      .expect(200);
    expect(upd.body.name).toBe('Renamed');
  });

  it('renders a preview with sample data and with a real lead', async () => {
    const created = await request(app.getHttpServer())
      .post('/templates')
      .set('Authorization', auth(0))
      .send({
        name: 'Preview me',
        subject: 'Hi {first_name|there}',
        bodyHtml: '<p>{business_name|your company}</p>',
      })
      .expect(201);
    const id = created.body.id;

    const sample = await request(app.getHttpServer())
      .post(`/templates/${id}/preview`)
      .set('Authorization', auth(0))
      .send({})
      .expect(200);
    expect(sample.body.subject).toBe('Hi Alex');
    expect(sample.body.html).toContain('Acme Corp');

    const lead = await request(app.getHttpServer())
      .post('/leads')
      .set('Authorization', auth(0))
      .send({ firstName: 'Dana', company: 'Globex' })
      .expect(201);

    const withLead = await request(app.getHttpServer())
      .post(`/templates/${id}/preview`)
      .set('Authorization', auth(0))
      .send({ leadId: lead.body.id })
      .expect(200);
    expect(withLead.body.subject).toBe('Hi Dana');
    expect(withLead.body.html).toContain('Globex');
  });

  it('duplicates a template with a "(copy)" suffix', async () => {
    const dup = await request(app.getHttpServer())
      .post(`/templates/${templateId}/duplicate`)
      .set('Authorization', auth(0))
      .expect(201);
    expect(dup.body.name).toMatch(/\(copy\)$/);
    expect(dup.body.id).not.toBe(templateId);
  });

  it('creates a folder and files a template into it', async () => {
    const folder = await request(app.getHttpServer())
      .post('/templates/folders')
      .set('Authorization', auth(0))
      .send({ name: 'Outbound' })
      .expect(201);

    const created = await request(app.getHttpServer())
      .post('/templates')
      .set('Authorization', auth(0))
      .send({ name: 'In folder', folderId: folder.body.id })
      .expect(201);
    expect(created.body.folder_id).toBe(folder.body.id);

    const inFolder = await request(app.getHttpServer())
      .get(`/templates?folderId=${folder.body.id}`)
      .set('Authorization', auth(0))
      .expect(200);
    expect(inFolder.body).toHaveLength(1);
  });

  it('test-sends a rendered template through a mock sender', async () => {
    const sender = await request(app.getHttpServer())
      .post('/senders')
      .set('Authorization', auth(0))
      .send({ provider: 'smtp', fromName: 'Rep', fromEmail: 'rep@demo.local' })
      .expect(201);

    const res = await request(app.getHttpServer())
      .post(`/templates/${templateId}/test`)
      .set('Authorization', auth(0))
      .send({ senderId: sender.body.id, to: 'prospect@demo.local' })
      .expect(200);
    // EMAIL_DRIVER=mock in the test env -> mock provider returns a mock id.
    expect(res.body.messageId).toMatch(/^mock-/);
  });

  it('isolates templates between orgs', async () => {
    const list = await request(app.getHttpServer())
      .get('/templates')
      .set('Authorization', auth(1))
      .expect(200);
    // org 1 sees only its own seeded starters, none of org 0's additions.
    expect(list.body).toHaveLength(DEFAULT_TEMPLATES.length);

    await request(app.getHttpServer())
      .get(`/templates/${templateId}`)
      .set('Authorization', auth(1))
      .expect(404);
  });
});
