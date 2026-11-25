import { BLOCK_LABELS, DAY_LABELS, localSlot } from './send-time';
import {
  type BucketRow,
  FACTOR_BY_ID,
  FACTOR_IDS,
  type FactorId,
  type GridRow,
  type InsightsData,
  type MixFactor,
} from './types';

/**
 * Per-company facts -> bucket rows and the send-time grid (Learning Loop T06).
 * Pure: the Postgres source feeds it rows, tests feed it fixtures. One company
 * is one row, however many people at it were contacted.
 */

/** Factor values are plain strings; "unknown" is a real, visible bucket. */
export type FactorValues = Record<
  Exclude<FactorId, 'send_day' | 'send_hour' | 'sequence_step'>,
  string
>;

export interface InsightCompany {
  companyKey: string;
  /** First first-touch (step 1) email sent to the company. */
  firstSentAt: Date;
  /** The company's IANA timezone from the enrollment snapshot, if known. */
  recipientTz: string | null;
  bounced: boolean;
  opened: boolean;
  replied: boolean;
  positive: boolean;
  qualified: boolean;
  booked: boolean;
  unsubscribed: boolean;
  hoursToFirstReply: number | null;
  /** Step of the email the first reply answered. */
  replyStep: number | null;
  factors: FactorValues;
}

/** A verified Discover prospect (for the discovered -> eligible part of the funnel). */
export interface InsightProspect {
  country: string;
  region: string;
  city: string;
  industry: string;
  size_band: string;
  trigger: string;
  /** Has a real email on its site that accepts mail. */
  eligible: boolean;
}

export const unknownIfEmpty = (v: unknown): string => {
  const s =
    typeof v === 'number' ? String(v) : typeof v === 'string' ? v.trim() : '';
  return s === '' ? 'unknown' : s;
};

const median = (xs: number[]): number | null => {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

const MIX: Partial<Record<FactorId, MixFactor[]>> = {
  city: ['trigger', 'industry'],
  region: ['trigger', 'industry'],
  country: ['trigger', 'industry'],
  industry: ['trigger', 'city'],
  trigger: ['city', 'industry'],
};

const FUNNEL_FACTORS = new Set<FactorId>(
  [...FACTOR_BY_ID.values()].filter((f) => f.funnel).map((f) => f.id),
);

const EMPTY = {
  sent: 0,
  reached: 0,
  bounced: 0,
  opened: 0,
  replied: 0,
  positive: 0,
  qualified: 0,
  booked: 0,
  unsubscribed: 0,
  medianHoursToReply: null as number | null,
  discovered: 0,
  eligible: 0,
};

function summarise(cs: InsightCompany[]) {
  const reached = cs.filter((c) => !c.bounced);
  const count = (pred: (c: InsightCompany) => boolean) =>
    reached.filter(pred).length;
  return {
    sent: cs.length,
    reached: reached.length,
    bounced: cs.length - reached.length,
    opened: count((c) => c.opened),
    replied: count((c) => c.replied),
    positive: count((c) => c.positive),
    qualified: count((c) => c.qualified),
    booked: count((c) => c.booked),
    unsubscribed: count((c) => c.unsubscribed),
    medianHoursToReply: median(
      reached
        .filter((c) => c.replied && c.hoursToFirstReply !== null)
        .map((c) => c.hoursToFirstReply as number),
    ),
  };
}

export function aggregateInsights(
  companies: InsightCompany[],
  prospects: InsightProspect[],
  workspaceTz: string,
): InsightsData {
  // send time, in the recipient's timezone when known
  const slotted = companies.map((c) => ({
    c,
    slot: localSlot(c.firstSentAt, c.recipientTz, workspaceTz),
  }));
  const recipient = slotted.filter((s) => s.slot.basis === 'recipient').length;

  // the value of every factor for every company
  const valueOf = (s: (typeof slotted)[number], f: FactorId): string | null => {
    if (f === 'send_day') return DAY_LABELS[s.slot.day];
    if (f === 'send_hour')
      return s.slot.block === null ? 'other' : BLOCK_LABELS[s.slot.block];
    if (f === 'sequence_step') {
      return s.c.replyStep === null ? null : `step ${s.c.replyStep}`;
    }
    return s.c.factors[f];
  };

  const overallCount = (f: MixFactor) => {
    const m = new Map<string, number>();
    for (const s of slotted) {
      const v = s.c.factors[f];
      m.set(v, (m.get(v) ?? 0) + 1);
    }
    return m;
  };
  const overalls = {
    trigger: overallCount('trigger'),
    industry: overallCount('industry'),
    city: overallCount('city'),
  };

  const buckets = {} as Record<FactorId, BucketRow[]>;
  for (const f of FACTOR_IDS) {
    const groups = new Map<string, typeof slotted>();
    for (const s of slotted) {
      const v = valueOf(s, f);
      if (v === null) continue;
      groups.set(v, [...(groups.get(v) ?? []), s]);
    }

    let rows: BucketRow[];
    if (f === 'sequence_step') {
      // a distribution of WHERE replies came from: counts, no per-company rate
      rows = [...groups.entries()]
        .sort((a, b) => a[0].localeCompare(b[0], undefined, { numeric: true }))
        .map(([bucket, ss]) => ({
          factor: f,
          bucket,
          ...EMPTY,
          sent: ss.length,
          reached: ss.length,
          replied: ss.length,
        }));
    } else {
      rows = [...groups.entries()].map(([bucket, ss]) => {
        const cs = ss.map((s) => s.c);
        const dominant: BucketRow['dominant'] = {};
        for (const mix of MIX[f] ?? []) {
          const tally = new Map<string, number>();
          for (const c of cs) {
            tally.set(c.factors[mix], (tally.get(c.factors[mix]) ?? 0) + 1);
          }
          const [value, n] = [...tally.entries()].sort(
            (a, b) => b[1] - a[1] || a[0].localeCompare(b[0]),
          )[0];
          dominant[mix] = {
            value,
            share: n / cs.length,
            overallShare: (overalls[mix].get(value) ?? 0) / companies.length,
          };
        }
        return {
          factor: f,
          bucket,
          ...EMPTY,
          ...summarise(cs),
          ...(MIX[f] ? { dominant } : {}),
        };
      });
    }

    if (FUNNEL_FACTORS.has(f)) {
      const key = f as keyof InsightProspect;
      const found = new Map<string, number>();
      const eligible = new Map<string, number>();
      for (const p of prospects) {
        const v = unknownIfEmpty(p[key]);
        found.set(v, (found.get(v) ?? 0) + 1);
        if (p.eligible) eligible.set(v, (eligible.get(v) ?? 0) + 1);
      }
      const byBucket = new Map(rows.map((r) => [r.bucket, r]));
      for (const [v, n] of found) {
        const r = byBucket.get(v) ?? { factor: f, bucket: v, ...EMPTY };
        r.discovered = n;
        r.eligible = eligible.get(v) ?? 0;
        if (!byBucket.has(v)) {
          byBucket.set(v, r);
          rows.push(r);
        }
      }
    }
    buckets[f] = rows.sort(
      (a, b) => b.reached - a.reached || a.bucket.localeCompare(b.bucket),
    );
  }

  // day x 2-hour block grid, over reached companies
  const cells = new Map<string, GridRow>();
  for (const s of slotted) {
    if (s.c.bounced || s.slot.block === null) continue;
    const k = `${s.slot.day}:${s.slot.block}`;
    const cell = cells.get(k) ?? {
      day: s.slot.day,
      block: s.slot.block,
      reached: 0,
      replied: 0,
      qualified: 0,
    };
    cell.reached += 1;
    if (s.c.replied) cell.replied += 1;
    if (s.c.qualified) cell.qualified += 1;
    cells.set(k, cell);
  }

  const {
    sent,
    reached,
    bounced,
    opened,
    replied,
    positive,
    qualified,
    booked,
    unsubscribed,
    medianHoursToReply,
  } = summarise(companies);
  return {
    buckets,
    grid: [...cells.values()].sort(
      (a, b) => a.day - b.day || a.block - b.block,
    ),
    timezone: {
      recipient,
      workspace: companies.length - recipient,
      workspaceZone: workspaceTz,
    },
    sendBlocksUsed: [
      ...new Set(
        slotted.map((s) => s.slot.block).filter((b): b is number => b !== null),
      ),
    ].sort((a, b) => a - b),
    totals: {
      sent,
      reached,
      bounced,
      opened,
      replied,
      positive,
      qualified,
      booked,
      unsubscribed,
      medianHoursToReply,
      discovered: prospects.length,
      eligible: prospects.filter((p) => p.eligible).length,
    },
  };
}
