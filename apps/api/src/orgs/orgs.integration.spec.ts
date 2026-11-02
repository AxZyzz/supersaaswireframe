/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument */
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'crypto';
import { Pool } from 'pg';
import request from 'supertest';
import { AppModule } from '../app.module';
import { PG_POOL } from '../db/db.module';
import { withOrgContext } from '../db/tenant-context';

/** E9 chunk 1: workspace profile, branding, onboarding state, setup checklist. */
describe('Org profile integration', () => {
  let app: INestApplication;
  let pool: Pool;
  const accounts: { token: string; orgId: string; userId: string }[] = [];

  const http = () => request(app.getHttpServer());
  const as = (i: number) => `Bearer ${accounts[i].token}`;

  // 1x1 transparent PNG
  const PNG =
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

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

    for (const orgName of ['Acme Org', 'Other Org']) {
      const res = await http()
        .post('/auth/signup')
        .send({
          email: `org-${randomUUID().slice(0, 8)}@test.local`,
          password: 'org-pass-123',
          name: 'Org T',
          orgName,
        })
        .expect(201);
      accounts.push({
        token: res.body.accessToken,
        orgId: res.body.org.id,
        userId: res.body.user.id,
      });
    }
  });

  afterAll(async () => {
    for (const a of accounts) {
      await withOrgContext(pool, a.orgId, async (c) => {
        await c.query(`DELETE FROM orgs WHERE id = $1`, [a.orgId]);
      });
      await pool.query(`DELETE FROM users WHERE id = $1`, [a.userId]);
    }
    await app.close();
  });

  it('a fresh workspace starts un-onboarded with defaults', async () => {
    const r = await http()
      .get('/orgs/me')
      .set('Authorization', as(0))
      .expect(200);
    expect(r.body.name).toBe('Acme Org');
    expect(r.body.timezone).toBe('UTC');
    expect(r.body.onboarded_at).toBeNull();
    expect(r.body.brand_color).toBeNull();
  });

  it('admin updates profile + branding; blank strings clear fields', async () => {
    const r = await http()
      .patch('/orgs/me')
      .set('Authorization', as(0))
      .send({
        name: '  Acme Inc ',
        website: 'https://acme.example',
        industry: 'Agency',
        teamSize: '2-10',
        timezone: 'Asia/Kolkata',
        brandColor: '#0f766e',
        logoData: PNG,
      })
      .expect(200);
    expect(r.body).toMatchObject({
      name: 'Acme Inc',
      website: 'https://acme.example',
      team_size: '2-10',
      timezone: 'Asia/Kolkata',
      brand_color: '#0f766e',
      logo_data: PNG,
    });

    const cleared = await http()
      .patch('/orgs/me')
      .set('Authorization', as(0))
      .send({ industry: '', logoData: null })
      .expect(200);
    expect(cleared.body.industry).toBeNull();
    expect(cleared.body.logo_data).toBeNull();
    expect(cleared.body.brand_color).toBe('#0f766e'); // untouched
  });

  it('rejects bad colors, timezones, logos and empty names', async () => {
    for (const body of [
      { brandColor: 'red' },
      { timezone: 'Mars/Olympus' },
      { logoData: 'https://evil.example/logo.png' },
      { logoData: 'data:text/html;base64,PHNjcmlwdD4=' },
      { website: 'javascript:alert(1)' },
      { teamSize: '1000' },
      { name: '   ' },
    ]) {
      await http()
        .patch('/orgs/me')
        .set('Authorization', as(0))
        .send(body)
        .expect(400);
    }
  });

  it('updates never leak across workspaces', async () => {
    const other = await http()
      .get('/orgs/me')
      .set('Authorization', as(1))
      .expect(200);
    expect(other.body.name).toBe('Other Org');
    expect(other.body.brand_color).toBeNull();
  });

  it('setup checklist reflects real progress; onboarding completes once', async () => {
    let s = await http()
      .get('/orgs/me/setup')
      .set('Authorization', as(1))
      .expect(200);
    expect(s.body).toEqual({
      profile: false,
      knowledge: false,
      sender: false,
      senderVerified: false,
      leads: false,
      campaign: false,
      onboarded: false,
    });

    await http()
      .post('/leads')
      .set('Authorization', as(1))
      .send({ email: 'lead@other.local' })
      .expect(201);
    await http()
      .put('/ai/knowledge')
      .set('Authorization', as(1))
      .send({ description: 'We build things.' })
      .expect(200);
    await http()
      .post('/senders')
      .set('Authorization', as(1))
      .send({ provider: 'smtp', fromName: 'Rep', fromEmail: 'rep@other.local' })
      .expect(201);

    const done = await http()
      .post('/orgs/me/onboarding/complete')
      .set('Authorization', as(1))
      .expect(200);
    expect(done.body.onboardedAt).toBeTruthy();
    // idempotent — the first completion time sticks
    const again = await http()
      .post('/orgs/me/onboarding/complete')
      .set('Authorization', as(1))
      .expect(200);
    expect(again.body.onboardedAt).toBe(done.body.onboardedAt);

    s = await http()
      .get('/orgs/me/setup')
      .set('Authorization', as(1))
      .expect(200);
    expect(s.body).toMatchObject({
      knowledge: true,
      sender: true,
      senderVerified: false,
      leads: true,
      campaign: false,
      onboarded: true,
    });
  });

  it('non-admins cannot edit the workspace', async () => {
    // demote the second account's own membership to agent, re-login for a fresh token
    await withOrgContext(pool, accounts[1].orgId, async (c) => {
      await c.query(
        `UPDATE memberships SET role = 'agent' WHERE user_id = $1`,
        [accounts[1].userId],
      );
    });
    const r = await pool.query<{ email: string }>(
      `SELECT email FROM users WHERE id = $1`,
      [accounts[1].userId],
    );
    const fresh = await http()
      .post('/auth/login')
      .send({ email: r.rows[0].email, password: 'org-pass-123' })
      .expect(200);
    const agent = `Bearer ${fresh.body.accessToken}`;
    await http()
      .patch('/orgs/me')
      .set('Authorization', agent)
      .send({ name: 'Hijack' })
      .expect(403);
    await http()
      .post('/orgs/me/onboarding/complete')
      .set('Authorization', agent)
      .expect(403);
    // reading stays open to every member
    await http().get('/orgs/me/setup').set('Authorization', agent).expect(200);
  });
});
