import { Inject, Injectable, Logger } from '@nestjs/common';
import { Pool } from 'pg';
import { PG_POOL } from '../db/db.module';
import { withOrgContext } from '../db/tenant-context';
import {
  FetchLike,
  GmailAuthError,
  googleAccessToken,
} from '../senders/providers/gmail.provider';
import { SendersService } from '../senders/senders.service';
import { InboxService } from './inbox.service';

const GMAIL_API = 'https://gmail.googleapis.com/gmail/v1/users/me';
// First sync looks back this far; later syncs overlap the previous one a
// little so a message delivered during a sync isn't missed.
const FIRST_LOOKBACK_S = 3 * 24 * 3600;
const OVERLAP_S = 15 * 60;
const MAX_MESSAGES = 200;

export interface ReplySyncResult {
  senderId: string;
  replies: number;
  bounces: number;
  ignored: number;
  error: string | null;
}

interface GmailPart {
  mimeType?: string;
  headers?: { name: string; value: string }[];
  body?: { data?: string };
  parts?: GmailPart[];
}

interface GmailMessage {
  id: string;
  snippet?: string;
  payload?: GmailPart;
}

type Kind = 'reply' | 'bounce' | 'ignored';

const EMAIL_RE = /[a-z0-9._%+'-]+@[a-z0-9.-]+\.[a-z]{2,}/i;

/** "Pat <pat@x.com>" → "pat@x.com" (lower-case). */
export function addressOf(header: string | undefined): string | null {
  const m = header ? (/<([^>]+)>/.exec(header) ?? EMAIL_RE.exec(header)) : null;
  if (!m) return null;
  return (m[1] ?? m[0]).trim().toLowerCase();
}

const decode = (data?: string) =>
  data ? Buffer.from(data, 'base64url').toString('utf8') : '';

function findPart(p: GmailPart | undefined, mime: string): GmailPart | null {
  if (!p) return null;
  if (p.mimeType === mime && p.body?.data) return p;
  for (const child of p.parts ?? []) {
    const hit = findPart(child, mime);
    if (hit) return hit;
  }
  return null;
}

/** Plain-text body: text/plain, else text/html with tags removed. */
export function bodyText(msg: GmailMessage): string {
  const plain = findPart(msg.payload, 'text/plain');
  if (plain) return decode(plain.body?.data);
  const html = findPart(msg.payload, 'text/html');
  if (html) {
    return decode(html.body?.data)
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(p|div)>/gi, '\n')
      .replace(/<[^>]+>/g, '')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>');
  }
  return decode(msg.payload?.body?.data) || msg.snippet || '';
}

/**
 * Drops the quoted earlier conversation a mail client appends to a reply
 * ("On Tue, … wrote:", "> …" lines, "-----Original Message-----"), so the
 * inbox and the classifier see only what the lead actually wrote.
 */
export function stripQuoted(text: string): string {
  const t = text.replace(/\r\n/g, '\n');
  const cut = [
    /\n[^\n]*On [^\n]{0,200}\n?[^\n]{0,200}wrote:\s*\n/, // Gmail/Apple (may wrap)
    /\n-{2,}\s*Original Message\s*-{2,}/i, // Outlook
    /\n_{5,}\s*\nFrom: /, // Outlook web
  ]
    .map((re) => re.exec(t)?.index ?? -1)
    .filter((i) => i >= 0);
  const head = cut.length ? t.slice(0, Math.min(...cut)) : t;
  const out = head
    .split('\n')
    .filter((line) => !/^\s*>/.test(line))
    .join('\n')
    .trim();
  return out || t.trim();
}

/**
 * Gmail reply reading (T5.7, google-stack Phase 2). Polls each Gmail sender
 * that granted `gmail.readonly` and:
 *  - hands replies from leads we've emailed to InboxService.ingestReply
 *    (classification, stop-on-reply, notifications: the normal path);
 *  - turns mailer-daemon bounces for addresses we've emailed into
 *    suppression + stopped sequences;
 *  - ignores everything else. Personal mail is never stored: only its Gmail
 *    id goes into gmail_seen_messages so it isn't fetched again.
 */
@Injectable()
export class GmailReplySyncService {
  private readonly log = new Logger(GmailReplySyncService.name);
  /** Test seam: replace Google's endpoints with a stub. */
  fetchFn: FetchLike = (input: string | URL | Request, init?: RequestInit) =>
    fetch(input, init);

  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    private readonly senders: SendersService,
    private readonly inbox: InboxService,
  ) {}

  /** Scheduler tick: every eligible Gmail sender not synced in the last minute. */
  async runDue(): Promise<{ synced: number; failed: number }> {
    const due = await this.pool.query<{ id: string; org_id: string }>(
      `SELECT * FROM due_gmail_reply_syncs($1::interval)`,
      ['1 minute'],
    );
    let failed = 0;
    for (const s of due.rows) {
      const r = await this.syncSender(s.org_id, s.id);
      if (r.error) failed++;
    }
    return { synced: due.rows.length, failed };
  }

  /** "Sync now" for one workspace: all its Gmail senders with read access. */
  async syncOrg(orgId: string): Promise<ReplySyncResult[]> {
    const ids = await withOrgContext(this.pool, orgId, async (c) => {
      const r = await c.query<{ id: string }>(
        `SELECT id FROM sender_accounts
         WHERE provider = 'gmail' AND status = 'verified'
           AND config -> 'gmail' ->> 'scope' LIKE '%gmail.readonly%'`,
      );
      return r.rows.map((x) => x.id);
    });
    const out: ReplySyncResult[] = [];
    for (const id of ids) out.push(await this.syncSender(orgId, id));
    return out;
  }

  async syncSender(orgId: string, senderId: string): Promise<ReplySyncResult> {
    const result: ReplySyncResult = {
      senderId,
      replies: 0,
      bounces: 0,
      ignored: 0,
      error: null,
    };
    try {
      const { sender, cfg } = await this.senders.gmailReadAccess(
        orgId,
        senderId,
      );
      const token = await googleAccessToken(cfg, this.fetchFn);
      const since = sender.reply_sync_at
        ? Math.floor(new Date(sender.reply_sync_at).getTime() / 1000) -
          OVERLAP_S
        : Math.floor(Date.now() / 1000) - FIRST_LOOKBACK_S;

      const ids = await this.listInbox(token, since);
      const seen = await withOrgContext(this.pool, orgId, async (c) => {
        const r = await c.query<{ gmail_message_id: string }>(
          `SELECT gmail_message_id FROM gmail_seen_messages
           WHERE sender_id = $1 AND gmail_message_id = ANY($2::text[])`,
          [senderId, ids],
        );
        return new Set(r.rows.map((x) => x.gmail_message_id));
      });

      // Gmail lists newest first; handle oldest first so threads build in order.
      for (const id of ids.filter((x) => !seen.has(x)).reverse()) {
        const msg = await this.get<GmailMessage>(
          token,
          `messages/${id}?format=full`,
        );
        const kind = await this.handle(orgId, sender.from_email, msg);
        result[
          kind === 'reply'
            ? 'replies'
            : kind === 'bounce'
              ? 'bounces'
              : 'ignored'
        ]++;
        await withOrgContext(this.pool, orgId, (c) =>
          c.query(
            `INSERT INTO gmail_seen_messages (org_id, sender_id, gmail_message_id, kind)
             VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING`,
            [orgId, senderId, id, kind],
          ),
        );
      }
    } catch (err) {
      result.error = err instanceof Error ? err.message : String(err);
      if (err instanceof GmailAuthError) {
        await this.senders.markAuthError(orgId, senderId, err);
      }
      this.log.warn(
        `Gmail reply sync failed for sender ${senderId}: ${result.error}`,
      );
    }
    await this.senders
      .recordReplySync(orgId, senderId, result.error)
      .catch(() => undefined);
    return result;
  }

  private async listInbox(token: string, sinceS: number): Promise<string[]> {
    const ids: string[] = [];
    let page: string | undefined;
    do {
      const qs = new URLSearchParams({
        q: `in:inbox after:${sinceS}`,
        maxResults: '100',
      });
      if (page) qs.set('pageToken', page);
      const r = await this.get<{
        messages?: { id: string }[];
        nextPageToken?: string;
      }>(token, `messages?${qs.toString()}`);
      ids.push(...(r.messages ?? []).map((m) => m.id));
      page = r.nextPageToken;
    } while (page && ids.length < MAX_MESSAGES);
    return ids.slice(0, MAX_MESSAGES);
  }

  private async get<T>(token: string, path: string): Promise<T> {
    const res = await this.fetchFn(`${GMAIL_API}/${path}`, {
      headers: { authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as {
        error?: { message?: string };
      };
      if (res.status === 401 || res.status === 403) {
        throw new Error(
          `Gmail refused to list messages (HTTP ${res.status}): ${body.error?.message ?? 'reconnect Gmail to allow reading replies'}`,
        );
      }
      throw new Error(
        `Gmail API error (HTTP ${res.status}): ${body.error?.message ?? 'unknown'}`,
      );
    }
    return (await res.json()) as T;
  }

  private async handle(
    orgId: string,
    ownAddress: string,
    msg: GmailMessage,
  ): Promise<Kind> {
    const h = new Map(
      (msg.payload?.headers ?? []).map((x) => [x.name.toLowerCase(), x.value]),
    );
    const from = addressOf(h.get('from'));
    if (!from || from === ownAddress.toLowerCase()) return 'ignored';

    if (/^(mailer-daemon|postmaster)@/i.test(from)) {
      const failed = new Set<string>();
      for (const a of (h.get('x-failed-recipients') ?? '').split(',')) {
        const e = addressOf(a);
        if (e) failed.add(e);
      }
      if (!failed.size) {
        const m = EMAIL_RE.exec(bodyText(msg));
        if (m) failed.add(m[0].toLowerCase());
      }
      let bounced = false;
      for (const email of failed) {
        if (await this.handleBounce(orgId, email)) bounced = true;
      }
      return bounced ? 'bounce' : 'ignored';
    }

    // Only mail from someone we've actually emailed is a reply worth reading.
    const emailed = await withOrgContext(this.pool, orgId, async (c) => {
      const r = await c.query(
        `SELECT 1 FROM sent_emails WHERE lower(to_email) = $1 LIMIT 1`,
        [from],
      );
      return (r.rowCount ?? 0) > 0;
    });
    if (!emailed) return 'ignored';

    try {
      await this.inbox.ingestReply(orgId, {
        fromEmail: from,
        subject: h.get('subject') ?? '',
        body: stripQuoted(bodyText(msg)).slice(0, 20000),
        messageId: h.get('message-id'),
        inReplyTo: h.get('in-reply-to')?.trim(),
      });
      return 'reply';
    } catch (err) {
      this.log.warn(
        `Skipped a Gmail reply: ${err instanceof Error ? err.message : String(err)}`,
      );
      return 'ignored';
    }
  }

  /**
   * A hard bounce for an address we emailed: suppress it workspace-wide,
   * stop its active sequences, and record the bounce (feeds analytics and the
   * lead timeline). Returns false for addresses we never emailed.
   */
  private handleBounce(orgId: string, email: string): Promise<boolean> {
    return withOrgContext(this.pool, orgId, async (c) => {
      const last = await c.query<{
        campaign_id: string | null;
        lead_id: string | null;
      }>(
        `SELECT campaign_id, lead_id FROM sent_emails
         WHERE lower(to_email) = $1 ORDER BY sent_at DESC LIMIT 1`,
        [email],
      );
      if (!last.rows[0]) return false;
      const { campaign_id, lead_id } = last.rows[0];
      await c.query(
        `INSERT INTO suppression_list (org_id, email, reason)
         VALUES ($1, $2, 'bounced')
         ON CONFLICT (org_id, lower(email)) DO NOTHING`,
        [orgId, email],
      );
      await c.query(
        `UPDATE campaign_leads cl
         SET status = 'stopped', stop_reason = 'bounced', next_send_at = NULL,
             updated_at = now()
         FROM leads l
         WHERE cl.lead_id = l.id AND lower(l.email) = $1 AND cl.status = 'active'`,
        [email],
      );
      await c.query(
        `INSERT INTO email_events (org_id, campaign_id, lead_id, type, data)
         VALUES ($1, $2, $3, 'bounce', $4::jsonb)`,
        [orgId, campaign_id, lead_id, JSON.stringify({ email })],
      );
      if (lead_id) {
        await c.query(
          `INSERT INTO lead_events (org_id, lead_id, type, data)
           VALUES ($1, $2, 'email_bounced', $3::jsonb)`,
          [orgId, lead_id, JSON.stringify({ email })],
        );
      }
      return true;
    });
  }
}
