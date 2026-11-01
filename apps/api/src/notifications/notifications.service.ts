import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { Pool, PoolClient } from 'pg';
import { PG_POOL } from '../db/db.module';
import { withOrgContext } from '../db/tenant-context';

export interface NewNotification {
  type: string;
  title: string;
  body?: string;
  link?: string;
}

export interface NotificationRow {
  id: string;
  type: string;
  title: string;
  body: string;
  link: string | null;
  read_at: Date | null;
  created_at: Date;
}

// In-app notification center (T7.5). Writers call notify* inside their own
// org-context transaction so the notification commits atomically with the
// event that caused it.
@Injectable()
export class NotificationsService {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  // Fan out to every member of the org (one row each → per-user read state).
  async notifyOrg(c: PoolClient, orgId: string, n: NewNotification) {
    await c.query(
      `INSERT INTO notifications (org_id, user_id, type, title, body, link)
       SELECT $1, m.user_id, $2, $3, $4, $5 FROM memberships m`,
      [orgId, n.type, n.title, n.body ?? '', n.link ?? null],
    );
  }

  async notifyUser(
    c: PoolClient,
    orgId: string,
    userId: string,
    n: NewNotification,
  ) {
    await c.query(
      `INSERT INTO notifications (org_id, user_id, type, title, body, link)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [orgId, userId, n.type, n.title, n.body ?? '', n.link ?? null],
    );
  }

  list(orgId: string, userId: string) {
    return withOrgContext(this.pool, orgId, async (c) => {
      const r = await c.query<NotificationRow>(
        `SELECT id, type, title, body, link, read_at, created_at
         FROM notifications WHERE user_id = $1
         ORDER BY created_at DESC LIMIT 50`,
        [userId],
      );
      return r.rows;
    });
  }

  unreadCount(orgId: string, userId: string) {
    return withOrgContext(this.pool, orgId, async (c) => {
      const r = await c.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM notifications
         WHERE user_id = $1 AND read_at IS NULL`,
        [userId],
      );
      return { unread: r.rows[0].n };
    });
  }

  markRead(orgId: string, userId: string, id: string) {
    return withOrgContext(this.pool, orgId, async (c) => {
      const r = await c.query(
        `UPDATE notifications SET read_at = COALESCE(read_at, now())
         WHERE id = $1 AND user_id = $2`,
        [id, userId],
      );
      if (r.rowCount === 0)
        throw new NotFoundException('Notification not found');
      return { read: true };
    });
  }

  markAllRead(orgId: string, userId: string) {
    return withOrgContext(this.pool, orgId, async (c) => {
      const r = await c.query(
        `UPDATE notifications SET read_at = now()
         WHERE user_id = $1 AND read_at IS NULL`,
        [userId],
      );
      return { marked: r.rowCount ?? 0 };
    });
  }
}
