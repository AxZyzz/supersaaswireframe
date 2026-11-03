import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Pool } from 'pg';
import { PG_POOL } from '../db/db.module';
import { SystemMailService } from '../mail/system-mail.service';

interface Pending {
  id: string;
  org_id: string;
  user_id: string;
  type: string;
  title: string;
  body: string;
  link: string | null;
  read: boolean;
  created_at: Date;
  user_email: string;
  user_name: string;
  org_name: string;
  email_muted: boolean;
}

/** Notifications older than this are marked handled without an email. */
const STALE_MS = 48 * 3600_000;
/** A failed delivery is retried on later runs for this long. */
const RETRY_MS = 3600_000;

/**
 * Email side of the notification center (T7.5). Runs every minute: picks up
 * notifications that are at least `delay` old (so a burst of replies becomes
 * one email), skips ones the person already read in the app or muted for
 * email, and sends one email per person per workspace.
 */
@Injectable()
export class NotificationEmailService {
  private readonly log = new Logger(NotificationEmailService.name);

  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    private readonly mail: SystemMailService,
    private readonly config: ConfigService,
  ) {}

  private get webUrl() {
    return this.config
      .get<string>('WEB_URL', 'http://localhost:3000')
      .replace(/\/$/, '');
  }

  async flush(delaySeconds = 60): Promise<{ emails: number; handled: number }> {
    const res = await this.pool.query<Pending>(
      `SELECT * FROM pending_notification_emails($1, make_interval(secs => $2))`,
      [500, delaySeconds],
    );
    const groups = new Map<string, Pending[]>();
    for (const n of res.rows) {
      const k = `${n.org_id}:${n.user_id}`;
      groups.set(k, [...(groups.get(k) ?? []), n]);
    }

    let emails = 0;
    let handled = 0;
    for (const rows of groups.values()) {
      const now = Date.now();
      const due = rows.filter(
        (n) =>
          !n.email_muted &&
          !n.read &&
          now - new Date(n.created_at).getTime() < STALE_MS,
      );
      let delivered = true;
      if (due.length) {
        delivered = await this.mail.send(this.compose(due));
        if (delivered) emails++;
      }
      // Keep a failed batch for a retry while it's fresh and mail is set up;
      // otherwise mark it handled so nothing is emailed twice or forever.
      const retry =
        !delivered &&
        this.mail.configured &&
        due.some((n) => now - new Date(n.created_at).getTime() < RETRY_MS);
      if (!retry) {
        await this.pool.query(`SELECT mark_notifications_emailed($1::uuid[])`, [
          rows.map((n) => n.id),
        ]);
        handled += rows.length;
      }
    }
    if (emails) this.log.log(`sent ${emails} notification email(s)`);
    return { emails, handled };
  }

  private compose(due: Pending[]) {
    const first = due[0];
    const prefs = `${this.webUrl}/settings#notifications`;
    const footer = `You get these emails from ${first.org_name} on SuperSaaS. Change which ones: ${prefs}`;
    if (due.length === 1) {
      return {
        to: first.user_email,
        subject: `[${first.org_name}] ${first.title}`,
        text: `Hi ${first.user_name},\n\n${first.title}${
          first.body ? `\n${first.body}` : ''
        }\n\n${footer}`,
        action: {
          label: 'Open',
          url: `${this.webUrl}${first.link ?? '/dashboard'}`,
        },
      };
    }
    const lines = due
      .slice(0, 20)
      .map((n) => `• ${n.title}${n.body ? `: ${n.body}` : ''}`)
      .join('\n');
    const more = due.length > 20 ? `\n…and ${due.length - 20} more.` : '';
    return {
      to: first.user_email,
      subject: `[${first.org_name}] ${due.length} new notifications`,
      text: `Hi ${first.user_name},\n\n${lines}${more}\n\n${footer}`,
      action: { label: 'Open SuperSaaS', url: `${this.webUrl}/dashboard` },
    };
  }
}
