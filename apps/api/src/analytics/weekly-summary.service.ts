import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Pool } from 'pg';
import { PG_POOL } from '../db/db.module';
import { SystemMailService } from '../mail/system-mail.service';
import { AnalyticsService } from './analytics.service';

interface Recipient {
  org_id: string;
  org_name: string;
  user_id: string;
  user_email: string;
  user_name: string;
}

const pct = (n: number, d: number) =>
  d ? `${Math.round((n / d) * 100)}%` : '–';

/**
 * Monday summary for admins and managers (T7.5): last 7 days of sending and
 * engagement, using the same numbers as the dashboard. Workspaces with no
 * activity that week get no email.
 */
@Injectable()
export class WeeklySummaryService {
  private readonly log = new Logger(WeeklySummaryService.name);

  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    private readonly analytics: AnalyticsService,
    private readonly mail: SystemMailService,
    private readonly config: ConfigService,
  ) {}

  async run(now = new Date()): Promise<{ workspaces: number; emails: number }> {
    const res = await this.pool.query<Recipient>(
      `SELECT * FROM weekly_summary_recipients()`,
    );
    const byOrg = new Map<string, Recipient[]>();
    for (const r of res.rows) {
      byOrg.set(r.org_id, [...(byOrg.get(r.org_id) ?? []), r]);
    }
    const range = { from: new Date(now.getTime() - 7 * 86_400_000), to: now };
    const web = this.config
      .get<string>('WEB_URL', 'http://localhost:3000')
      .replace(/\/$/, '');

    let workspaces = 0;
    let emails = 0;
    for (const [orgId, people] of byOrg) {
      const ov = await this.analytics.overview(orgId, range);
      const sent = ov.sent.total;
      const e = ov.engagement;
      if (!sent && !e.replied && !ov.leads.new7) continue; // a quiet week
      workspaces++;
      const top = (await this.analytics.campaigns(orgId, range))
        .filter((c) => c.sent > 0)
        .sort((a, b) => b.replied - a.replied || b.sent - a.sent)
        .slice(0, 3)
        .map(
          (c) =>
            `• ${c.name}: ${c.sent} sent, ${c.replied} repl${c.replied === 1 ? 'y' : 'ies'}`,
        );
      const text = [
        `Your week in ${people[0].org_name}:`,
        [
          `Emails sent: ${sent}`,
          `Opened: ${e.opened} (${pct(e.opened, sent)})`,
          `Clicked: ${e.clicked}`,
          `Replies: ${e.replied}`,
          `New leads: ${ov.leads.new7}`,
          ...(e.bounced || e.unsubscribed
            ? [`Bounced: ${e.bounced} · Unsubscribed: ${e.unsubscribed}`]
            : []),
        ].join('\n'),
        ...(top.length ? [`Top campaigns:\n${top.join('\n')}`] : []),
        `You get this every Monday as a workspace admin/manager. Turn it off: ${web}/settings#notifications`,
      ];
      for (const p of people) {
        const ok = await this.mail.send({
          to: p.user_email,
          subject: `[${p.org_name}] Your week: ${sent} sent, ${e.replied} repl${e.replied === 1 ? 'y' : 'ies'}`,
          text: `Hi ${p.user_name},\n\n${text.join('\n\n')}`,
          action: { label: 'Open analytics', url: `${web}/analytics` },
        });
        if (ok) emails++;
      }
    }
    this.log.log(
      `weekly summary: ${workspaces} workspace(s), ${emails} email(s)`,
    );
    return { workspaces, emails };
  }
}
