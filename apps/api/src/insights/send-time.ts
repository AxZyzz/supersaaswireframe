import { isValidTimeZone } from '../prospects/attributes';

/**
 * Send time in the RECIPIENT's timezone when we know it (Learning Loop T06),
 * else the workspace timezone (and we say so). Done with Intl in code, not in
 * SQL, so a bad timezone string can never break a query.
 */

/** 2-hour blocks from 06:00 to 22:00: index 0 = 6-8 ... 7 = 20-22. */
export const BLOCK_LABELS = [
  '6-8 am',
  '8-10 am',
  '10 am-12',
  '12-2 pm',
  '2-4 pm',
  '4-6 pm',
  '6-8 pm',
  '8-10 pm',
] as const;
export const DAY_LABELS = [
  'Mon',
  'Tue',
  'Wed',
  'Thu',
  'Fri',
  'Sat',
  'Sun',
] as const;

export const blockOfHour = (hour: number): number | null =>
  hour >= 6 && hour < 22 ? Math.floor((hour - 6) / 2) : null;

export interface LocalSlot {
  /** 0 = Monday ... 6 = Sunday */
  day: number;
  hour: number;
  /** 0..7, or null for hours outside 6-22 ("other"). */
  block: number | null;
  basis: 'recipient' | 'workspace';
}

const WEEKDAY: Record<string, number> = {
  Mon: 0,
  Tue: 1,
  Wed: 2,
  Thu: 3,
  Fri: 4,
  Sat: 5,
  Sun: 6,
};

export function localSlot(
  sentAt: Date,
  recipientTz: string | null | undefined,
  workspaceTz: string,
): LocalSlot {
  const useRecipient = !!recipientTz && isValidTimeZone(recipientTz);
  const tz = useRecipient
    ? recipientTz
    : isValidTimeZone(workspaceTz)
      ? workspaceTz
      : 'UTC';
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    weekday: 'short',
    hour: 'numeric',
    hourCycle: 'h23',
  }).formatToParts(sentAt);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  const hour = Number(get('hour')) % 24;
  return {
    day: WEEKDAY[get('weekday')] ?? 0,
    hour,
    block: blockOfHour(hour),
    basis: useRecipient ? 'recipient' : 'workspace',
  };
}
