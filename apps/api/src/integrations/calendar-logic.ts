/**
 * Pure rules for "booked call verified from Google Calendar" (Learning Loop T16).
 * No database and no network here, so every rule is easy to test.
 *
 * Privacy: we only ever look at an event's id, status, start, created time and
 * the attendee EMAIL addresses. Titles and descriptions are never requested
 * from Google and never stored.
 */

/** Read-only access to the events on the connected calendars. */
export const CALENDAR_SCOPE =
  'https://www.googleapis.com/auth/calendar.events.readonly';

/** How long after our email a booking still counts as its result (days). */
export const DEFAULT_RESPONSE_WINDOW_DAYS = 14;

/** Read this far ahead (days) and one day back (a meeting booked for today). */
export const LOOK_AHEAD_DAYS = 30;
export const LOOK_BACK_DAYS = 1;

/** Re-read events changed a little before the last sync (clock skew, slow writes). */
export const SYNC_OVERLAP_MS = 5 * 60_000;

/** What the Google events.list call returns for the fields we ask for. */
export interface RawCalendarEvent {
  id?: string;
  status?: string;
  created?: string;
  updated?: string;
  start?: { dateTime?: string; date?: string };
  attendees?: {
    email?: string;
    self?: boolean;
    resource?: boolean;
    responseStatus?: string;
  }[];
}

export interface CalendarEvent {
  id: string;
  cancelled: boolean;
  /** Event start (ISO). Null for a cancelled event Google sent without one. */
  start: string | null;
  /** When the event was created: the moment the lead booked. */
  created: string | null;
  /** Lower-case attendee emails that could be a lead (never us, never rooms). */
  attendees: string[];
}

/** The fields mask for events.list: nothing but what the rules above need. */
export const EVENT_FIELDS =
  'nextPageToken,items(id,status,created,updated,start,attendees(email,self,resource,responseStatus))';

/**
 * Google event -> our shape. Drops the connected account itself, resource
 * calendars (rooms) and people who declined, and lower-cases every address so
 * "Jane@Acme.com" matches the lead "jane@acme.com".
 */
export function parseEvent(
  raw: RawCalendarEvent,
  accountEmail: string,
): CalendarEvent | null {
  if (!raw.id) return null;
  const me = accountEmail.trim().toLowerCase();
  const seen = new Set<string>();
  for (const a of raw.attendees ?? []) {
    const email = a.email?.trim().toLowerCase();
    if (!email || a.self || a.resource) continue;
    if (a.responseStatus === 'declined') continue;
    if (email === me) continue;
    seen.add(email);
  }
  const start = raw.start?.dateTime ?? raw.start?.date ?? null;
  return {
    id: raw.id,
    cancelled: raw.status === 'cancelled',
    start: start ? new Date(start).toISOString() : null,
    created: raw.created ? new Date(raw.created).toISOString() : null,
    attendees: [...seen],
  };
}

/** Idempotency keys: one real meeting always maps to the same key. */
export const calendarKeys = {
  booked: (calendarId: string, eventId: string) =>
    `cal:${calendarId.toLowerCase()}:${eventId}`,
  cancelled: (calendarId: string, eventId: string) =>
    `calcancel:${calendarId.toLowerCase()}:${eventId}`,
};

/** One delivered email we sent a lead (the candidates a booking can answer). */
export interface SendCandidate {
  sentEmailId: string;
  leadId: string;
  sentAt: Date;
  /** The experiment's response window, when the email belonged to one. */
  windowDays: number | null;
}

/**
 * Does this booking answer this email? Yes when the event was created after we
 * sent the email and no later than the response window afterwards.
 */
export function bookingAnswers(
  send: Pick<SendCandidate, 'sentAt' | 'windowDays'>,
  bookedAt: Date,
): boolean {
  const days =
    send.windowDays && send.windowDays > 0
      ? send.windowDays
      : DEFAULT_RESPONSE_WINDOW_DAYS;
  const from = send.sentAt.getTime();
  return (
    bookedAt.getTime() >= from && bookedAt.getTime() <= from + days * 86_400_000
  );
}

/**
 * Which email does a booking answer? Of the candidates inside their window,
 * the most recent one (it carries the enrollment, experiment and variant).
 * null = no match: nothing is recorded, we never guess.
 */
export function pickSend(
  candidates: SendCandidate[],
  bookedAt: Date,
): SendCandidate | null {
  let best: SendCandidate | null = null;
  for (const c of candidates) {
    if (!bookingAnswers(c, bookedAt)) continue;
    if (!best || c.sentAt.getTime() > best.sentAt.getTime()) best = c;
  }
  return best;
}

/** Time range to read: yesterday to 30 days ahead. */
export function readRange(now: Date): { timeMin: string; timeMax: string } {
  return {
    timeMin: new Date(
      now.getTime() - LOOK_BACK_DAYS * 86_400_000,
    ).toISOString(),
    timeMax: new Date(
      now.getTime() + LOOK_AHEAD_DAYS * 86_400_000,
    ).toISOString(),
  };
}

/**
 * Only events changed since the last good sync (with an overlap); the very
 * first sync has no cursor and reads everything in range.
 */
export function updatedMin(lastSyncedAt: string | null): string | null {
  if (!lastSyncedAt) return null;
  const t = Date.parse(lastSyncedAt);
  if (Number.isNaN(t)) return null;
  return new Date(t - SYNC_OVERLAP_MS).toISOString();
}
