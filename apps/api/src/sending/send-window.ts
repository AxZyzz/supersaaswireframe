import { createHash } from 'crypto';
import { isValidTimeZone } from '../prospects/attributes';

/**
 * Learning Loop T17: send windows.
 *
 * A window says WHEN a campaign may send: some weekdays, between two whole
 * hours, on the clock of the RECIPIENT (their timezone, falling back to the
 * workspace's) or of the workspace. This file is pure maths on instants and
 * IANA timezones (Intl only): no database, no clock of its own. The send path
 * passes `now` in, so tests can walk a fake clock across weekends and DST.
 *
 * Conventions
 *  - days are ISO weekdays: 1 = Monday ... 7 = Sunday;
 *  - startHour 0..23, endHour 1..24 (exclusive), startHour < endHour: no
 *    overnight windows (a 22:00-06:00 window is two different days to a
 *    recipient; keep it simple);
 *  - the window is resolved to real instants per local calendar day, so a DST
 *    change just makes that day's window an hour shorter or longer (and a
 *    window that falls entirely inside the skipped hour is empty that day).
 */

export type TzBasis = 'recipient' | 'workspace';

export interface SendWindow {
  /** ISO weekdays, 1 = Monday ... 7 = Sunday, ascending, no duplicates. */
  days: number[];
  startHour: number;
  endHour: number;
  tzBasis: TzBasis;
}

const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;
const HOUR_MS = 3_600_000;
const MINUTE_MS = 60_000;

/** Why a window is not acceptable, in plain words; null when it is fine. */
export function sendWindowError(raw: unknown): string | null {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return 'A send window needs days, a start hour, an end hour and a timezone basis.';
  }
  const w = raw as Record<string, unknown>;
  if (!Array.isArray(w.days) || w.days.length === 0) {
    return 'Pick at least one day to send on.';
  }
  const seen = new Set<number>();
  for (const d of w.days) {
    if (!Number.isInteger(d) || (d as number) < 1 || (d as number) > 7) {
      return 'Days must be 1 (Monday) to 7 (Sunday).';
    }
    if (seen.has(d as number)) return 'Each day can only be listed once.';
    seen.add(d as number);
  }
  const { startHour, endHour } = w;
  if (
    !Number.isInteger(startHour) ||
    (startHour as number) < 0 ||
    (startHour as number) > 23
  ) {
    return 'The start hour must be a whole hour from 0 to 23.';
  }
  if (
    !Number.isInteger(endHour) ||
    (endHour as number) < 1 ||
    (endHour as number) > 24
  ) {
    return 'The end hour must be a whole hour from 1 to 24.';
  }
  if ((endHour as number) <= (startHour as number)) {
    return 'The end hour must be after the start hour (no overnight windows).';
  }
  if (w.tzBasis !== 'recipient' && w.tzBasis !== 'workspace') {
    return "The timezone basis must be 'recipient' or 'workspace'.";
  }
  return null;
}

/** A valid window in canonical form (sorted days), or null. Never throws. */
export function parseSendWindow(raw: unknown): SendWindow | null {
  if (sendWindowError(raw) !== null) return null;
  const w = raw as SendWindow;
  return {
    days: [...w.days].sort((a, b) => a - b),
    startHour: w.startHour,
    endHour: w.endHour,
    tzBasis: w.tzBasis,
  };
}

/** True when two windows are the same schedule. */
export function sameSendWindow(a: SendWindow, b: SendWindow): boolean {
  return (
    a.startHour === b.startHour &&
    a.endHour === b.endHour &&
    a.tzBasis === b.tzBasis &&
    a.days.length === b.days.length &&
    a.days.every((d, i) => d === b.days[i])
  );
}

/** "Tue-Thu 09:00-11:00 (recipient time)": for labels, history and the UI. */
export function describeSendWindow(w: SendWindow): string {
  const days = [...w.days].sort((a, b) => a - b);
  const runs: string[] = [];
  let i = 0;
  while (i < days.length) {
    let j = i;
    while (j + 1 < days.length && days[j + 1] === days[j] + 1) j++;
    runs.push(
      j - i >= 2
        ? `${DAY_NAMES[days[i] - 1]}-${DAY_NAMES[days[j] - 1]}`
        : days
            .slice(i, j + 1)
            .map((d) => DAY_NAMES[d - 1])
            .join(', '),
    );
    i = j + 1;
  }
  const hh = (h: number) => `${String(h).padStart(2, '0')}:00`;
  return `${runs.join(', ')} ${hh(w.startHour)}-${hh(w.endHour)} (${
    w.tzBasis === 'recipient' ? 'recipient' : 'workspace'
  } time)`;
}

/**
 * The IANA zone a window is read in. Recipient basis: the lead's timezone when
 * it is a real zone, else the workspace's, else UTC. Workspace basis ignores
 * the lead. A bad string can never throw: it just falls through.
 */
export function resolveWindowZone(
  basis: TzBasis,
  recipientTz: string | null | undefined,
  workspaceTz: string | null | undefined,
): { tz: string; usedWorkspaceFallback: boolean } {
  const ws = workspaceTz && isValidTimeZone(workspaceTz) ? workspaceTz : 'UTC';
  if (basis === 'recipient' && recipientTz && isValidTimeZone(recipientTz)) {
    return { tz: recipientTz, usedWorkspaceFallback: false };
  }
  return { tz: ws, usedWorkspaceFallback: basis === 'recipient' };
}

// ── time zone arithmetic (Intl only) ─────────────────────────────────────

const formatters = new Map<string, Intl.DateTimeFormat>();
function fmt(tz: string): Intl.DateTimeFormat {
  let f = formatters.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
    });
    formatters.set(tz, f);
  }
  return f;
}

interface Wall {
  year: number;
  month: number; // 1..12
  day: number;
  hour: number;
  minute: number;
  second: number;
}

/** The wall clock in `tz` at an instant. */
function wallAt(tz: string, instantMs: number): Wall {
  const parts = fmt(tz).formatToParts(new Date(instantMs));
  const get = (t: string) =>
    Number(parts.find((p) => p.type === t)?.value ?? '0');
  return {
    year: get('year'),
    month: get('month'),
    day: get('day'),
    hour: get('hour') % 24,
    minute: get('minute'),
    second: get('second'),
  };
}

/** Offset of `tz` from UTC at an instant, in minutes (local - UTC). */
function offsetMinutes(tz: string, instantMs: number): number {
  const w = wallAt(tz, instantMs);
  const asUtc = Date.UTC(
    w.year,
    w.month - 1,
    w.day,
    w.hour,
    w.minute,
    w.second,
  );
  // formatToParts has second resolution: compare against the truncated instant
  return Math.round((asUtc - Math.floor(instantMs / 1000) * 1000) / MINUTE_MS);
}

/**
 * The instant at which the wall clock in `tz` reads y-m-d h:00.
 *  - A time that happens twice (clocks go back): the FIRST one.
 *  - A time that does not exist (clocks go forward): shifted forward by the
 *    gap, so 02:00 on a spring-forward day is 03:00.
 */
export function zonedWallToUtc(
  tz: string,
  year: number,
  month: number,
  day: number,
  hour: number,
): number {
  const guess = Date.UTC(year, month - 1, day, hour, 0, 0);
  const o1 = offsetMinutes(tz, guess);
  const t1 = guess - o1 * MINUTE_MS;
  const o2 = offsetMinutes(tz, t1);
  if (o1 === o2) return t1;
  const t2 = guess - o2 * MINUTE_MS;
  const valid = [
    { t: t1, o: o1 },
    { t: t2, o: o2 },
  ].filter((c) => offsetMinutes(tz, c.t) === c.o);
  if (valid.length > 0) return Math.min(...valid.map((c) => c.t));
  return Math.max(t1, t2); // inside the skipped hour
}

/** y-m-d plus n calendar days (timezone free), with its ISO weekday. */
function addDays(
  year: number,
  month: number,
  day: number,
  n: number,
): { year: number; month: number; day: number; isoWeekday: number } {
  const d = new Date(Date.UTC(year, month - 1, day + n));
  return {
    year: d.getUTCFullYear(),
    month: d.getUTCMonth() + 1,
    day: d.getUTCDate(),
    isoWeekday: d.getUTCDay() === 0 ? 7 : d.getUTCDay(),
  };
}

export interface WindowSlot {
  start: Date;
  end: Date;
}

/** One local calendar day's window as real instants; null when it is empty. */
function slotOn(
  w: SendWindow,
  tz: string,
  year: number,
  month: number,
  day: number,
): WindowSlot | null {
  const start = zonedWallToUtc(tz, year, month, day, w.startHour);
  const next = addDays(year, month, day, 1);
  const end =
    w.endHour === 24
      ? zonedWallToUtc(tz, next.year, next.month, next.day, 0)
      : zonedWallToUtc(tz, year, month, day, w.endHour);
  return end > start ? { start: new Date(start), end: new Date(end) } : null;
}

/**
 * The first window slot that has not ended yet at `from` (it may already be
 * open: check `slot.start <= from`). Looks at most 8 local days ahead, which
 * always finds one for a window with at least one day.
 */
export function slotAtOrAfter(
  w: SendWindow,
  from: Date,
  tz: string,
): WindowSlot | null {
  const today = wallAt(tz, from.getTime());
  for (let i = 0; i <= 8; i++) {
    const d = addDays(today.year, today.month, today.day, i);
    if (!w.days.includes(d.isoWeekday)) continue;
    const slot = slotOn(w, tz, d.year, d.month, d.day);
    if (slot && slot.end.getTime() > from.getTime()) return slot;
  }
  return null;
}

/** Is `at` inside the window, read on the clock of `tz`? */
export function isInsideWindow(w: SendWindow, at: Date, tz: string): boolean {
  const slot = slotAtOrAfter(w, at, tz);
  return !!slot && slot.start.getTime() <= at.getTime();
}

/** Deterministic number in [0, 1) from a seed (same hash idea as assignment). */
export function spreadFraction(seed: string): number {
  const buf = createHash('sha256').update(seed).digest();
  return Number(buf.readBigUInt64BE(0)) / 18446744073709551616;
}

/**
 * Where a send that is due `now` should go.
 *  - Inside the window: `{ inside: true }`, send now (sender caps still apply).
 *  - Outside: the next opening PLUS a deterministic spread across that slot, so
 *    1,000 leads that were due overnight do not all fire at 09:00:00. The spread
 *    leaves the last few minutes of the slot alone so a pushed send does not
 *    arrive after the window has closed.
 */
export function scheduleInWindow(args: {
  window: SendWindow;
  now: Date;
  recipientTz: string | null | undefined;
  workspaceTz: string | null | undefined;
  /** Stable per send (campaign_lead id + step), so a retry lands in the same place. */
  seed: string;
}): {
  inside: boolean;
  nextSendAt: Date | null;
  tz: string;
  usedWorkspaceFallback: boolean;
} {
  const { tz, usedWorkspaceFallback } = resolveWindowZone(
    args.window.tzBasis,
    args.recipientTz,
    args.workspaceTz,
  );
  const slot = slotAtOrAfter(args.window, args.now, tz);
  if (!slot) {
    // cannot happen for a valid window; never block sending on a maths gap
    return { inside: true, nextSendAt: null, tz, usedWorkspaceFallback };
  }
  if (slot.start.getTime() <= args.now.getTime()) {
    return { inside: true, nextSendAt: null, tz, usedWorkspaceFallback };
  }
  const len = slot.end.getTime() - slot.start.getTime();
  const tail = Math.min(5 * MINUTE_MS, Math.floor(len / 10));
  const span = Math.max(0, len - tail - 1);
  const offset = Math.floor(
    spreadFraction(`${args.seed}:${slot.start.toISOString()}`) * span,
  );
  return {
    inside: false,
    nextSendAt: new Date(slot.start.getTime() + offset),
    tz,
    usedWorkspaceFallback,
  };
}

export const HOURS_PER_DAY_MS = 24 * HOUR_MS;
