import type { ArmCounts } from './policy';

/**
 * Turns per-company rows into the counts the T04 policy needs, plus the
 * display-only audience slices. Pure: real data (from SQL) and simulated data
 * go through the SAME function, so what you see in a simulation is exactly how
 * real results are counted. The unit is the company.
 */

export interface CompanyRow {
  variantId: string;
  companyKey: string;
  /** First eligible (step 1) send, null if not sent yet. */
  firstSentAt: Date | null;
  /** A real (non-bot) open on a step-1 email. */
  opened: boolean;
  bounced: boolean;
  /** Sent, not bounced, but still not delivered (only ever set in simulations). */
  undelivered?: boolean;
  replied: boolean;
  /** A verified qualified reply inside the company's response window. */
  qualifiedVerified: boolean;
  /** An AI-labelled qualified reply still waiting for a person. */
  qualifiedProvisional: boolean;
  booked: boolean;
  unsubscribed: boolean;
  complaint: boolean;
  city: string | null;
  industry: string | null;
  trigger: string | null;
}

export interface VariantInfo {
  id: string;
  label: string;
  isControl: boolean;
}

export const SLICE_FACTORS = ['city', 'industry', 'trigger'] as const;
export type SliceFactor = (typeof SLICE_FACTORS)[number];

/** A bucket needs at least this many assigned companies to be shown on its own. */
export const MIN_BUCKET_COMPANIES = 10;

export interface SliceBucket {
  value: string;
  assigned: number;
  arms: Array<{
    variantId: string;
    assigned: number;
    qualified: number;
    rate: number | null;
  }>;
}

export interface Slice {
  factor: SliceFactor;
  /** Always labelled exploratory in the UI: never a decision. */
  buckets: SliceBucket[];
}

export interface Aggregate {
  arms: ArmCounts[];
  /** When the last sent company's response window closes (null: nothing sent). */
  earliestFullRead: Date | null;
  slices: Slice[];
}

const DAY_MS = 86_400_000;

export function aggregate(
  rows: CompanyRow[],
  variants: VariantInfo[],
  now: Date,
  windowDays: number,
): Aggregate {
  const closes = (r: CompanyRow) =>
    r.firstSentAt
      ? new Date(r.firstSentAt.getTime() + windowDays * DAY_MS)
      : null;

  const arms: ArmCounts[] = variants.map((v) => {
    const mine = rows.filter((r) => r.variantId === v.id);
    const sent = mine.filter((r) => r.firstSentAt !== null);
    const count = (pred: (r: CompanyRow) => boolean) =>
      mine.filter(pred).length;
    const bounced = sent.filter((r) => r.bounced).length;
    return {
      variantId: v.id,
      label: v.label,
      isControl: v.isControl,
      assigned: mine.length,
      sent: sent.length,
      delivered: sent.filter((r) => !r.bounced && !r.undelivered).length,
      bounced,
      opened: count((r) => r.opened),
      replied: count((r) => r.replied),
      qualifiedVerified: count((r) => r.qualifiedVerified),
      qualifiedProvisional: count((r) => r.qualifiedProvisional),
      booked: count((r) => r.booked),
      unsubscribed: count((r) => r.unsubscribed),
      complaints: count((r) => r.complaint),
      windowClosed: count((r) => {
        const c = closes(r);
        return c !== null && c <= now;
      }),
    };
  });

  const closeTimes = rows
    .map(closes)
    .filter((d): d is Date => d !== null)
    .map((d) => d.getTime());
  const earliestFullRead =
    closeTimes.length > 0 ? new Date(Math.max(...closeTimes)) : null;

  return {
    arms,
    earliestFullRead,
    slices: SLICE_FACTORS.map((f) => buildSlice(f, rows, variants)),
  };
}

const valueOf = (r: CompanyRow, f: SliceFactor): string => {
  const v = f === 'trigger' ? r.trigger : r[f];
  return v && v.trim() ? v : 'unknown';
};

/** Buckets under the minimum fold into "other"; "unknown" is always shown. */
export function buildSlice(
  factor: SliceFactor,
  rows: CompanyRow[],
  variants: VariantInfo[],
): Slice {
  const groups = new Map<string, CompanyRow[]>();
  for (const r of rows) {
    const k = valueOf(r, factor);
    groups.set(k, [...(groups.get(k) ?? []), r]);
  }
  const named: Array<[string, CompanyRow[]]> = [];
  const other: CompanyRow[] = [];
  for (const [k, rs] of groups) {
    if (k === 'unknown' || rs.length >= MIN_BUCKET_COMPANIES) {
      named.push([k, rs]);
    } else {
      other.push(...rs);
    }
  }
  named.sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]));
  if (other.length > 0) named.push(['other', other]);

  const bucket = (value: string, rs: CompanyRow[]): SliceBucket => ({
    value,
    assigned: rs.length,
    arms: variants.map((v) => {
      const mine = rs.filter((r) => r.variantId === v.id);
      const q = mine.filter((r) => r.qualifiedVerified).length;
      return {
        variantId: v.id,
        assigned: mine.length,
        qualified: q,
        rate: mine.length > 0 ? q / mine.length : null,
      };
    }),
  });
  return { factor, buckets: named.map(([k, rs]) => bucket(k, rs)) };
}
