/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument */
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'crypto';
import { Pool } from 'pg';
import request from 'supertest';
import { AppModule } from '../app.module';
import { WeeklySummaryService } from '../analytics/weekly-summary.service';
import { PG_POOL } from '../db/db.module';
import { withOrgContext } from '../db/tenant-context';
import { SystemMailService } from '../mail/system-mail.service';
import { NotificationEmailService } from './notification-email.service';
import { NotificationsService } from './notifications.service';

/** Email notifications + weekly summary (T7.5), mail captured in the outbox. */
describe('Notification emails integration', () => {
  let app: INestApplication;
  let pool: Pool;
  let mail: SystemMailService;
  let emails: NotificationEmailService;
  let weekly: WeeklySummaryService;
  let notifications: NotificationsService;
  let token: string;
  let orgId: string;
  let userId: string;
  const email = `ne-${randomUUID().slice(0, 8)}@test.local`;
  const http = () => request(app.getHttpServer());
  const auth = () => ({ Authorization: `Bearer ${token}` });
  const mine = () => mail.outbox.filter((m) => m.to === email);

  const notify = (type: string, title: string, body = '') =>
    withOrgContext(pool, orgId, (c) =>
      notifications.notifyUser(c, orgId, userId, {
        type,
        title,
        body,
        link: '/inbox',
      }),
    );
  const pending = async () =>
    (
      await withOrgContext(pool, orgId, (c) =>
        c.query<{ n: number }>(
          `SELECT count(*)::int AS n FROM notifications WHERE user_id = $1 AND emailed_at IS NULL`,
          [userId],
        ),
      )
    ).rows[0].n;

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
    mail = app.get(SystemMailService);
    emails = app.get(NotificationEmailService);
    weekly = app.get(WeeklySummaryService);
    notifications = app.get(NotificationsService);
    const res = await http()
      .post('/auth/signup')
      .send({
        email,
        password: 'ne-pass-123',
        name: 'Nia',
        orgName: 'Notify Co',
      })
      .expect(201);
    token = res.body.accessToken;
    orgId = res.body.org.id;
    userId = res.body.user.id;
  });

  afterAll(async () => {
    await withOrgContext(pool, orgId, (c) =>
      c.query(`DELETE FROM orgs WHERE id = $1`, [orgId]),
    );
    await pool.query(`DELETE FROM users WHERE id = $1`, [userId]);
    await app.close();
  });

  it('lists email preferences (incl. the weekly summary) and validates updates', async () => {
    const r = await http()
      .get('/notifications/email-preferences')
      .set(auth())
      .expect(200);
    const prefs = r.body as { type: string; enabled: boolean }[];
    expect(prefs.map((p) => p.type)).toEqual([
      'reply',
      'assigned',
      'member_joined',
      'weekly_summary',
    ]);
    expect(prefs.every((p) => p.enabled)).toBe(true);
    await http()
      .put('/notifications/email-preferences')
      .set(auth())
      .send({ muted: ['nonsense'] })
      .expect(400);
  });

  it('waits out the delay, then sends one email per notification', async () => {
    await notify('reply', 'Priya replied', 'Sounds good, call Tuesday?');
    const beforeFresh = mine().length;
    await emails.flush(60); // too fresh: nothing for this user yet
    expect(mine().length).toBe(beforeFresh);
    expect(await pending()).toBe(1);

    const before = mine().length;
    await emails.flush(0);
    const sent = mine().slice(before);
    expect(sent).toHaveLength(1);
    expect(sent[0].subject).toBe('[Notify Co] Priya replied');
    expect(sent[0].text).toContain('Sounds good, call Tuesday?');
    expect(sent[0].text).toContain('/settings#notifications');
    expect(sent[0].action!.url).toMatch(/\/inbox$/);
    expect(await pending()).toBe(0);

    await emails.flush(0); // nothing twice
    expect(mine().length).toBe(before + 1);
  });

  it('batches a burst into one email', async () => {
    const before = mine().length;
    await notify('reply', 'A replied');
    await notify('reply', 'B replied');
    await notify('assigned', 'C was assigned to you');
    await emails.flush(0);
    const sent = mine().slice(before);
    expect(sent).toHaveLength(1);
    expect(sent[0].subject).toBe('[Notify Co] 3 new notifications');
    expect(sent[0].text).toMatch(
      /• A replied[\s\S]*• B replied[\s\S]*• C was assigned/,
    );
  });

  it('skips muted types and notifications already read in the app', async () => {
    await http()
      .put('/notifications/email-preferences')
      .set(auth())
      .send({ muted: ['reply'] })
      .expect(200);
    const before = mine().length;
    await notify('reply', 'Muted reply');
    await notify('assigned', 'Seen in app');
    await withOrgContext(pool, orgId, (c) =>
      c.query(
        `UPDATE notifications SET read_at = now() WHERE title = 'Seen in app' AND user_id = $1`,
        [userId],
      ),
    );
    await emails.flush(0);
    expect(mine().length).toBe(before); // neither emailed
    expect(await pending()).toBe(0); // but both handled

    // in-app notifications are unaffected by email mutes
    const inApp = await http().get('/notifications').set(auth()).expect(200);
    expect(JSON.stringify(inApp.body)).toContain('Muted reply');
    await http()
      .put('/notifications/email-preferences')
      .set(auth())
      .send({ muted: [] })
      .expect(200);
  });

  it('weekly summary: quiet weeks send nothing; active weeks report the numbers', async () => {
    let before = mine().length;
    await weekly.run();
    expect(mine().length).toBe(before); // nothing happened this week

    await withOrgContext(pool, orgId, async (c) => {
      const se = await c.query<{ id: string }>(
        `INSERT INTO sent_emails (org_id, to_email, subject, status, tracking_id)
         VALUES ($1, 'x@prospect.test', 'Hi', 'sent', $2), ($1, 'y@prospect.test', 'Hi', 'sent', $3)
         RETURNING id`,
        [orgId, randomUUID(), randomUUID()],
      );
      await c.query(
        `INSERT INTO email_events (org_id, sent_email_id, type) VALUES ($1, $2, 'open')`,
        [orgId, se.rows[0].id],
      );
    });
    before = mine().length;
    await weekly.run();
    const sent = mine().slice(before);
    expect(sent).toHaveLength(1);
    expect(sent[0].subject).toBe('[Notify Co] Your week: 2 sent, 0 replies');
    expect(sent[0].text).toContain('Emails sent: 2');
    expect(sent[0].text).toContain('Opened: 1 (50%)');
    expect(sent[0].action!.url).toMatch(/\/analytics$/);

    await http()
      .put('/notifications/email-preferences')
      .set(auth())
      .send({ muted: ['weekly_summary'] })
      .expect(200);
    before = mine().length;
    await weekly.run();
    expect(mine().length).toBe(before);
  });
});
