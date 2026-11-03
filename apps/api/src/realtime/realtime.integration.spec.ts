/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-return */
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'crypto';
import { Pool } from 'pg';
import { io, Socket } from 'socket.io-client';
import request from 'supertest';
import { AppModule } from '../app.module';
import { PG_POOL } from '../db/db.module';
import { withOrgContext } from '../db/tenant-context';

/** T7.2: live updates over Socket.io — authenticated, org-isolated, and
 *  carrying only "what changed". */
describe('Realtime gateway', () => {
  let app: INestApplication;
  let pool: Pool;
  let url: string;
  const sockets: Socket[] = [];
  const users: string[] = [];
  const orgs: string[] = [];

  const http = () => request(app.getHttpServer());
  const signup = async (orgName: string) => {
    const r = await http()
      .post('/auth/signup')
      .send({
        email: `rt-${randomUUID().slice(0, 8)}@test.local`,
        password: 'rt-pass-123',
        name: 'Rt',
        orgName,
      })
      .expect(201);
    users.push(r.body.user.id);
    orgs.push(r.body.org.id);
    return r.body;
  };

  /** Connects and resolves with the first lifecycle event. */
  const connect = (token?: string) =>
    new Promise<{ socket: Socket; event: 'ready' | 'unauthorized' }>(
      (resolve, reject) => {
        const socket = io(url, {
          path: '/realtime',
          auth: token ? { token } : {},
          transports: ['websocket'],
          reconnection: false,
        });
        sockets.push(socket);
        socket.once('ready', () => resolve({ socket, event: 'ready' }));
        socket.once('unauthorized', () =>
          resolve({ socket, event: 'unauthorized' }),
        );
        socket.once('connect_error', reject);
      },
    );

  const nextChange = (socket: Socket, type: string, ms = 3000) =>
    new Promise<{ type: string; id?: string } | null>((resolve) => {
      const t = setTimeout(() => resolve(null), ms);
      const handler = (e: { type: string; id?: string }) => {
        if (e.type !== type) return;
        clearTimeout(t);
        socket.off('change', handler);
        resolve(e);
      };
      socket.on('change', handler);
    });

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
    await app.listen(0);
    url = await app.getUrl();
    url = url.replace('[::1]', 'localhost');
    pool = app.get<Pool>(PG_POOL);
  });

  afterAll(async () => {
    sockets.forEach((s) => s.disconnect());
    for (const id of orgs) {
      await withOrgContext(pool, id, (c) =>
        c.query(`DELETE FROM orgs WHERE id = $1`, [id]),
      );
    }
    for (const id of users)
      await pool.query(`DELETE FROM users WHERE id = $1`, [id]);
    await app.close();
  });

  it('rejects connections without a valid access token', async () => {
    expect((await connect()).event).toBe('unauthorized');
    expect((await connect('not-a-jwt')).event).toBe('unauthorized');
  });

  it('pushes inbox + notification changes to the right workspace only', async () => {
    const a = await signup('Live A');
    const b = await signup('Live B');
    const sa = (await connect(a.accessToken)).socket;
    const sb = (await connect(b.accessToken)).socket;

    // A has a contacted lead so a reply can be ingested
    const auth = `Bearer ${a.accessToken}`;
    await http()
      .post('/senders')
      .set('Authorization', auth)
      .send({ provider: 'smtp', fromName: 'Rep', fromEmail: 'rep@live.local' })
      .expect(201);
    await http()
      .post('/leads')
      .set('Authorization', auth)
      .send({ email: 'lead@live.local' })
      .expect(201);
    const tpls = await http().get('/templates').set('Authorization', auth);
    const camp = await http()
      .post('/campaigns')
      .set('Authorization', auth)
      .send({ name: 'Live' })
      .expect(201);
    await http()
      .post(`/campaigns/${camp.body.id}/steps`)
      .set('Authorization', auth)
      .send({ templateId: tpls.body[0].id, delayHours: 0 })
      .expect(201);
    await http()
      .post(`/campaigns/${camp.body.id}/enroll`)
      .set('Authorization', auth)
      .expect(200);

    const campaignsEvt = nextChange(sa, 'campaigns');
    await http().post('/sending/tick').set('Authorization', auth).expect(200);
    expect(await campaignsEvt).toEqual({ type: 'campaigns' });

    const inboxA = nextChange(sa, 'inbox');
    const notifA = nextChange(sa, 'notifications');
    const leakB = nextChange(sb, 'inbox', 1500);
    const r = await http()
      .post('/inbox/simulate-reply')
      .set('Authorization', auth)
      .send({ fromEmail: 'lead@live.local', body: 'Sounds good' })
      .expect(201);

    // only "what changed" — no message content travels over the socket
    expect(await inboxA).toEqual({ type: 'inbox', id: r.body.conversationId });
    expect(await notifA).toEqual({ type: 'notifications' });
    expect(await leakB).toBeNull();
  });

  it('refuses a token whose user is no longer a member', async () => {
    const c = await signup('Gone Co');
    await withOrgContext(pool, c.org.id, (q) =>
      q.query(`DELETE FROM memberships WHERE user_id = $1`, [c.user.id]),
    );
    // the membership cache entry for this fresh user is empty, so it re-reads
    expect((await connect(c.accessToken)).event).toBe('unauthorized');
  });
});
