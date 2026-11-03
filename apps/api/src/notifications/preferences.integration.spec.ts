/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return */
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'crypto';
import { Pool } from 'pg';
import request from 'supertest';
import { AppModule } from '../app.module';
import { PG_POOL } from '../db/db.module';
import { withOrgContext } from '../db/tenant-context';

/** Members can mute notification types per workspace. */
describe('Notification preferences', () => {
  let app: INestApplication;
  let pool: Pool;
  let token: string;
  let orgId: string;
  const users: string[] = [];
  const http = () => request(app.getHttpServer());
  const auth = () => `Bearer ${token}`;

  const joins = async () => {
    const inv = await http()
      .post('/orgs/invites')
      .set('Authorization', auth())
      .send({
        email: `np-${randomUUID().slice(0, 8)}@test.local`,
        role: 'agent',
      })
      .expect(201);
    const reg = await http()
      .post(`/invites/${inv.body.token}/register`)
      .send({ name: 'Joiner', password: 'np-pass-123' })
      .expect(201);
    users.push(reg.body.user.id);
  };
  const joinedCount = async () =>
    (
      await http().get('/notifications').set('Authorization', auth())
    ).body.filter((n: { type: string }) => n.type === 'member_joined').length;

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
    const r = await http()
      .post('/auth/signup')
      .send({
        email: `np-${randomUUID().slice(0, 8)}@test.local`,
        password: 'np-pass-123',
        name: 'Np',
        orgName: 'Prefs Org',
      })
      .expect(201);
    token = r.body.accessToken;
    orgId = r.body.org.id;
    users.push(r.body.user.id);
    // seats for the joiners
    await withOrgContext(pool, orgId, (c) =>
      c.query(`UPDATE orgs SET plan = 'internal' WHERE id = $1`, [orgId]),
    );
  });

  afterAll(async () => {
    await withOrgContext(pool, orgId, (c) =>
      c.query(`DELETE FROM orgs WHERE id = $1`, [orgId]),
    );
    for (const id of users)
      await pool.query(`DELETE FROM users WHERE id = $1`, [id]);
    await app.close();
  });

  it('lists every type, enabled by default', async () => {
    const r = await http()
      .get('/notifications/preferences')
      .set('Authorization', auth())
      .expect(200);
    expect(r.body.map((p: { type: string }) => p.type)).toEqual([
      'reply',
      'assigned',
      'member_joined',
    ]);
    expect(r.body.every((p: { enabled: boolean }) => p.enabled)).toBe(true);
  });

  it('muted types are not delivered; unmuting restores them', async () => {
    const r = await http()
      .put('/notifications/preferences')
      .set('Authorization', auth())
      .send({ muted: ['member_joined'] })
      .expect(200);
    expect(
      r.body.find((p: { type: string }) => p.type === 'member_joined').enabled,
    ).toBe(false);

    await joins();
    expect(await joinedCount()).toBe(0);

    await http()
      .put('/notifications/preferences')
      .set('Authorization', auth())
      .send({ muted: [] })
      .expect(200);
    await joins();
    expect(await joinedCount()).toBe(1);
  });

  it('rejects unknown types', async () => {
    await http()
      .put('/notifications/preferences')
      .set('Authorization', auth())
      .send({ muted: ['everything'] })
      .expect(400);
  });
});
