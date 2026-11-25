import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Pool } from 'pg';
import { PG_POOL } from '../db/db.module';
import { withOrgContext } from '../db/tenant-context';
import { googleCreds } from '../google/google-oauth';
import { OutcomesService } from '../outcomes/outcomes.service';
import {
  FetchLike,
  GmailAuthError,
  googleAccessToken,
} from '../senders/providers/gmail.provider';
import {
  CalendarEvent,
  calendarKeys,
  EVENT_FIELDS,
  parseEvent,
  pickSend,
  RawCalendarEvent,
  readRange,
  SendCandidate,
  updatedMin,
} from './calendar-logic';
import { IntegrationsService } from './integrations.service';

const EVENTS_API =
  'https://www.googleapis.com/calendar/v3/calendars/primary/events';
/** A tick runs every 15 min; 14 keeps a sync that finished a few seconds late due. */
const SYNC_EVERY = '14 minutes';
/** Safety caps: 10 pages of 250 events per workspace per sync. */
const PAGE_SIZE = 250;
const MAX_PAGES = 10;
/** Sends older than this can never answer a booking (longest sensible window). */
const SEND_LOOKBACK_DAYS = 120;

export interface CalendarSyncResult {
  events: number;
  booked: number;
  cancelled: number;
}

/**
 * Google Calendar -> verified booked calls (Learning Loop T16).
 *
 * Every 15 minutes, for each workspace with a connected calendar: read the
 * events changed since the last sync (the first sync reads yesterday to 30
 * days ahead), match attendee emails to leads we emailed inside the response
 * window, and record a `booked_call` outcome (source `calendar`, verified, key
 * `cal:<calendar>:<event>` so a repeat sync never duplicates). A cancelled
 * event adds a superseding `rejected` row. We request only event id, status,
 * start, created time and attendee emails: never a title or description.
 * Code decides; no AI is involved.
 */
@Injectable()
export class CalendarSyncService {
  private readonly log = new Logger(CalendarSyncService.name);
  /** Swappable in tests. */
  fetchFn: FetchLike = (input: string | URL | Request, init?: RequestInit) =>
    fetch(input, init);

  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    private readonly config: ConfigService,
    private readonly integrations: IntegrationsService,
    private readonly outcomes: OutcomesService,
  ) {}

  /** The 15-minute job: every connected calendar not read in the last 14 minutes. */
  async runDue(): Promise<{ ran: number; failed: number }> {
    const due = await this.pool.query<{ org_id: string }>(
      `SELECT * FROM due_calendar_syncs($1::interval)`,
      [SYNC_EVERY],
    );
    let ran = 0;
    let failed = 0;
    for (const d of due.rows) {
      try {
        await this.syncOrg(d.org_id);
        ran++;
      } catch (err) {
        failed++;
        this.log.warn(
          `calendar sync ${d.org_id} failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
    if (ran || failed)
      this.log.log(`calendar syncs: ${ran} ran, ${failed} failed`);
    return { ran, failed };
  }

  /**
   * One workspace. Never throws for a problem the user can act on (revoked
   * access, API off): it records the problem on the integration instead, so
   * the Settings card can say what to do. Returns what it did.
   */
  async syncOrg(
    orgId: string,
    now: Date = new Date(),
  ): Promise<CalendarSyncResult> {
    const result: CalendarSyncResult = { events: 0, booked: 0, cancelled: 0 };
    const account = await this.integrations.calendarAccount(orgId);
    if (!account) return result;

    const { clientId, clientSecret } = googleCreds(this.config);
    let token: string;
    try {
      token = await googleAccessToken(
        {
          refreshToken: account.refreshToken,
          clientId: clientId ?? '',
          clientSecret: clientSecret ?? '',
        },
        this.fetchFn,
        'Google Calendar access was revoked or has expired. Reconnect it in Settings → Integrations.',
      );
    } catch (err) {
      await this.integrations.markCalendarSync(orgId, {
        ok: false,
        startedAt: now,
        error: err instanceof Error ? err.message : 'Google sign-in failed.',
        needsReconnect: err instanceof GmailAuthError,
      });
      return result;
    }

    let events: CalendarEvent[];
    try {
      events = await this.readEvents(token, account, now);
    } catch (err) {
      await this.integrations.markCalendarSync(orgId, {
        ok: false,
        startedAt: now,
        error: err instanceof Error ? err.message : 'Calendar read failed.',
        needsReconnect: err instanceof CalendarAuthError,
      });
      return result;
    }
    result.events = events.length;

    const range = readRange(now);
    const live = events.filter(
      (e) =>
        !e.cancelled &&
        e.start !== null &&
        e.attendees.length > 0 &&
        e.start >= range.timeMin &&
        e.start <= range.timeMax,
    );
    const candidates = await this.candidates(
      orgId,
      live.flatMap((e) => e.attendees),
      now,
    );

    for (const e of events) {
      if (e.cancelled) {
        const done = await withOrgContext(this.pool, orgId, (c) =>
          this.outcomes.recordCalendarCancel(
            c,
            orgId,
            calendarKeys.booked(account.accountEmail, e.id),
            calendarKeys.cancelled(account.accountEmail, e.id),
          ),
        );
        if (done) result.cancelled++;
        continue;
      }
      if (!live.includes(e)) continue;
      const bookedAt = new Date(e.created ?? now);
      let best: SendCandidate | null = null;
      for (const a of e.attendees) {
        const pick = pickSend(candidates.get(a) ?? [], bookedAt);
        if (pick && (!best || pick.sentAt > best.sentAt)) best = pick;
      }
      if (!best) continue; // nobody we emailed in time: never guess
      const rec = await withOrgContext(this.pool, orgId, (c) =>
        this.outcomes.record(c, orgId, {
          type: 'booked_call',
          source: 'calendar',
          verification: 'verified',
          autoVerified: true,
          idempotencyKey: calendarKeys.booked(account.accountEmail, e.id),
          occurredAt: new Date(e.start as string),
          leadId: best.leadId,
          sentEmailId: best.sentEmailId,
        }),
      );
      if (rec?.created) result.booked++;
    }

    await this.integrations.markCalendarSync(orgId, {
      ok: true,
      startedAt: now,
    });
    return result;
  }

  /** Delivered emails to these addresses, grouped by lower-case address. */
  private async candidates(
    orgId: string,
    emails: string[],
    now: Date,
  ): Promise<Map<string, SendCandidate[]>> {
    const out = new Map<string, SendCandidate[]>();
    const wanted = [...new Set(emails)];
    if (wanted.length === 0) return out;
    const r = await withOrgContext(this.pool, orgId, (c) =>
      c.query<{
        email: string;
        sent_email_id: string;
        lead_id: string;
        sent_at: Date;
        window_days: number | null;
      }>(
        `SELECT lower(l.email) AS email, s.id AS sent_email_id, l.id AS lead_id,
                s.sent_at, e.response_window_days AS window_days
           FROM leads l
           JOIN sent_emails s ON s.lead_id = l.id
           LEFT JOIN experiments e ON e.id = s.experiment_id
          WHERE lower(l.email) = ANY($1::text[])
            AND s.status = 'sent'
            AND s.sent_at <= $2
            AND s.sent_at >= $2::timestamptz - make_interval(days => $3)`,
        [wanted, now, SEND_LOOKBACK_DAYS],
      ),
    );
    for (const row of r.rows) {
      const list = out.get(row.email) ?? [];
      list.push({
        sentEmailId: row.sent_email_id,
        leadId: row.lead_id,
        sentAt: row.sent_at,
        windowDays: row.window_days,
      });
      out.set(row.email, list);
    }
    return out;
  }

  /** Pages of events as the connected account. Fields mask = no titles. */
  private async readEvents(
    token: string,
    account: { accountEmail: string; lastSyncedAt: string | null },
    now: Date,
  ): Promise<CalendarEvent[]> {
    const since = updatedMin(account.lastSyncedAt);
    const range = readRange(now);
    const events: CalendarEvent[] = [];
    let pageToken: string | undefined;
    for (let page = 0; page < MAX_PAGES; page++) {
      const q = new URLSearchParams({
        singleEvents: 'true',
        showDeleted: 'true',
        maxResults: String(PAGE_SIZE),
        fields: EVENT_FIELDS,
      });
      // Incremental: everything changed since the last sync (deleted events
      // always included, and a cancelled event may carry no start). First
      // sync: yesterday to 30 days ahead.
      if (since) q.set('updatedMin', since);
      else {
        q.set('timeMin', range.timeMin);
        q.set('timeMax', range.timeMax);
      }
      if (pageToken) q.set('pageToken', pageToken);
      const res = await this.fetchFn(`${EVENTS_API}?${q.toString()}`, {
        headers: { authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as {
          error?: { message?: string };
        };
        const detail = body.error?.message ?? 'unknown';
        if (res.status === 401) {
          throw new CalendarAuthError(
            'Google Calendar access was revoked or has expired. Reconnect it in Settings → Integrations.',
          );
        }
        throw new Error(
          `Google Calendar error (HTTP ${res.status}): ${detail}`,
        );
      }
      const body = (await res.json()) as {
        items?: RawCalendarEvent[];
        nextPageToken?: string;
      };
      for (const raw of body.items ?? []) {
        const e = parseEvent(raw, account.accountEmail);
        if (e) events.push(e);
      }
      pageToken = body.nextPageToken;
      if (!pageToken) break;
    }
    return events;
  }
}

/** Google said our access is no longer valid: the user must reconnect. */
class CalendarAuthError extends Error {}
