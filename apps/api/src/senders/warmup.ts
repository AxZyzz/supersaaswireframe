/**
 * Basic warm-up ramp (decision #2, T5.2). A new mailbox that suddenly sends
 * hundreds of cold emails gets flagged; ramping volume over its first month
 * builds sending reputation. Schedule from Spec → Finance → Rate Limits.
 *
 * The effective daily cap is the LOWER of the sender's configured daily
 * limit and the ramp step for its age. Warm-up can be switched off per
 * sender (e.g. an established mailbox).
 */
export const WARMUP_SCHEDULE: { untilDay: number; cap: number }[] = [
  { untilDay: 7, cap: 20 }, //   days 1–7
  { untilDay: 14, cap: 50 }, //  days 8–14
  { untilDay: 30, cap: 100 }, // days 15–30
];

const DAY_MS = 86_400_000;

/** 1-based day of warm-up, or null once the ramp is over / disabled. */
export function warmupDay(
  enabled: boolean,
  startedAt: Date,
  now = new Date(),
): number | null {
  if (!enabled) return null;
  const day = Math.floor((now.getTime() - startedAt.getTime()) / DAY_MS) + 1;
  return day <= WARMUP_SCHEDULE[WARMUP_SCHEDULE.length - 1].untilDay
    ? Math.max(1, day)
    : null;
}

export function effectiveDailyLimit(
  s: { daily_limit: number; warmup_enabled: boolean; warmup_started_at: Date },
  now = new Date(),
): number {
  const day = warmupDay(s.warmup_enabled, new Date(s.warmup_started_at), now);
  if (day === null) return s.daily_limit;
  const step = WARMUP_SCHEDULE.find((w) => day <= w.untilDay)!;
  return Math.min(s.daily_limit, step.cap);
}

/** Same rule as SQL, for queries that need it inline (`a` = table alias). */
export function effectiveLimitSql(a = ''): string {
  const p = a ? `${a}.` : '';
  const cases = WARMUP_SCHEDULE.map(
    (w) =>
      `WHEN now() - ${p}warmup_started_at < interval '${w.untilDay} days' THEN ${w.cap}`,
  ).join(' ');
  return `LEAST(${p}daily_limit, CASE WHEN NOT ${p}warmup_enabled THEN ${p}daily_limit ${cases} ELSE ${p}daily_limit END)`;
}
