import { wilson } from '../review/policy';
import { BLOCK_LABELS } from './send-time';
import {
  type BucketRow,
  type Dominant,
  FACTOR_BY_ID,
  type FactorId,
  type Metric,
  type MixFactor,
} from './types';

/**
 * The rules that turn bucket counts into plain sentences (Learning Loop T06).
 * Pure: no database, no AI. Everything it says is an EXPLORATORY observation
 * among contacted companies, never a decision: scanning many factors always
 * finds some that look good by chance, so a bucket is only called "best" when
 * even the cautious end of its range beats the overall rate.
 */

/** A group needs this many reached companies before it can be judged. */
export const MIN_REACHED = 30;
/** ...and this many events to be called "best". */
export const MIN_EVENTS = 3;
export const MAX_HEADLINES = 5;
/** Confounding hint: the bucket is mostly one value of another factor... */
export const CONFOUND_SHARE = 0.6;
/** ...and that value is clearly over-represented compared with everyone. */
export const CONFOUND_LIFT = 0.2;

export const EXPLORATORY_NOTE =
  'Observed among contacted companies. Could be caused by something else. Test it before acting.';

export const METRIC_NOUN: Record<Metric, string> = {
  reply: 'replies',
  positive: 'interested replies',
  qualified: 'confirmed qualified replies',
  booked: 'booked calls',
  open: 'opens (diagnostic: Apple Mail and others hide real opens)',
};

const numerator = (b: BucketRow, m: Metric): number =>
  ({
    reply: b.replied,
    positive: b.positive,
    qualified: b.qualified,
    booked: b.booked,
    open: b.opened,
  })[m];

export interface Rate {
  x: number;
  n: number;
  p: number | null;
  lo: number;
  hi: number;
}

export const rate = (x: number, n: number): Rate => {
  const w = wilson(x, n);
  return { x, n, p: w.p, lo: w.lo, hi: w.hi };
};

export type BucketStatus = 'best' | 'worst' | 'neutral' | 'thin';

export interface BucketStat extends Rate {
  bucket: string;
  status: BucketStatus;
  /** Median hours to first reply, bounce and unsubscribe rates (guardrail view). */
  medianHoursToReply: number | null;
  bounceRate: number | null;
  unsubscribeRate: number | null;
  discovered: number;
  eligible: number;
  sent: number;
  dominant?: BucketRow['dominant'];
}

export type Verdict = 'leader' | 'no_clear_leader' | 'not_enough_data';

export interface FactorEval {
  factor: FactorId;
  metric: Metric;
  overall: Rate;
  /** Buckets with enough data, sorted by rate (best first). */
  buckets: BucketStat[];
  /** Buckets with fewer than MIN_REACHED companies: shown, never judged. */
  thin: BucketStat[];
  verdict: Verdict;
  best: BucketStat | null;
  worst: BucketStat | null;
  /** When there is no clear leader: the top bucket by point estimate (grey). */
  topGrey: BucketStat | null;
}

const ratio = (x: number, n: number) => (n > 0 ? x / n : null);

function statOf(b: BucketRow, m: Metric): BucketStat {
  return {
    bucket: b.bucket,
    ...rate(numerator(b, m), b.reached),
    status: 'neutral',
    medianHoursToReply: b.medianHoursToReply,
    bounceRate: ratio(b.bounced, b.sent),
    unsubscribeRate: ratio(b.unsubscribed, b.reached),
    discovered: b.discovered,
    eligible: b.eligible,
    sent: b.sent,
    dominant: b.dominant,
  };
}

/** The leader rule for one factor and one metric. */
export function evaluateFactor(
  factor: FactorId,
  rows: BucketRow[],
  metric: Metric,
): FactorEval {
  const all = rows.reduce(
    (s, b) => ({ x: s.x + numerator(b, metric), n: s.n + b.reached }),
    { x: 0, n: 0 },
  );
  const overall = rate(all.x, all.n);
  const stats = rows.map((b) => statOf(b, metric));
  const thin = stats.filter((s) => s.n < MIN_REACHED);
  const judged = stats
    .filter((s) => s.n >= MIN_REACHED)
    .sort((a, b) => (b.p ?? 0) - (a.p ?? 0) || b.n - a.n);

  const op = overall.p ?? 0;
  for (const s of judged) {
    // best needs enough events AND the cautious end above the overall rate
    if (s.x >= MIN_EVENTS && s.lo > op) s.status = 'best';
    else if (s.hi < op) s.status = 'worst';
  }
  for (const s of thin) s.status = 'thin';

  const bests = judged.filter((s) => s.status === 'best');
  const best = bests.length
    ? bests.reduce((a, b) => (b.lo > a.lo ? b : a))
    : null;
  const worsts = judged.filter((s) => s.status === 'worst');
  const worst = worsts.length ? worsts[worsts.length - 1] : null;

  const verdict: Verdict =
    judged.length === 0
      ? 'not_enough_data'
      : best
        ? 'leader'
        : 'no_clear_leader';
  return {
    factor,
    metric,
    overall,
    buckets: judged,
    thin,
    verdict,
    best,
    worst,
    topGrey: verdict === 'no_clear_leader' ? judged[0] : null,
  };
}

// ── headline insights ───────────────────────────────────────────────────────

export interface Insight {
  id: string;
  factor: FactorId;
  factorLabel: string;
  metric: Metric;
  bucket: string;
  sentence: string;
  x: number;
  n: number;
  p: number;
  lo: number;
  hi: number;
  overallP: number;
  /** Lower bound minus overall rate: how clearly it beats everyone else. */
  gap: number;
  exploratory: string;
  /** "Most of these were also ..." when something else may explain it. */
  confounding: string | null;
  searchable: boolean;
  diagnostic: boolean;
}

const pct = (v: number) => `${(v * 100).toFixed(1)}%`;

const MIX_WORD: Record<MixFactor, (v: string) => string> = {
  trigger: (v) => v.replace(/_/g, ' '),
  industry: (v) => `in ${v.replace(/_/g, ' ')}`,
  city: (v) => `in ${v}`,
};
const MIX_LABEL: Record<MixFactor, string> = {
  trigger: 'trigger',
  industry: 'industry',
  city: 'city',
};

/** "Most of these were also ... Compare within X before deciding." (the Pune example). */
export function confoundingHint(
  factor: FactorId,
  dominant: BucketRow['dominant'],
): string | null {
  for (const key of Object.keys(dominant ?? {}) as MixFactor[]) {
    const d = (dominant as Record<MixFactor, Dominant>)[key];
    if (!d || key === factor || d.value === 'unknown') continue;
    if (d.share > CONFOUND_SHARE && d.share - d.overallShare >= CONFOUND_LIFT) {
      return `Most of these were also ${MIX_WORD[key](d.value)}. Compare within ${MIX_LABEL[key]} before deciding.`;
    }
  }
  return null;
}

const prettyBucket = (b: string) => b.replace(/_/g, ' ');

function sentenceFor(
  factor: FactorId,
  label: string,
  bucket: string,
  metric: Metric,
  s: BucketStat,
  overallP: number,
): string {
  const b = prettyBucket(bucket);
  const numbers = `${pct(s.p ?? 0)} (${s.x} of ${s.n} companies), range ${pct(s.lo)} to ${pct(s.hi)}. Overall: ${pct(overallP)}.`;
  const geo = factor === 'city' || factor === 'region' || factor === 'country';
  if (metric === 'reply' && geo) {
    return `Most replies come from ${b}: ${numbers}`;
  }
  return `${label}: ${b} gets the most ${METRIC_NOUN[metric]}: ${numbers}`;
}

/** At most MAX_HEADLINES clear leaders, largest significant gap first. */
export function buildInsights(
  evals: FactorEval[],
  max = MAX_HEADLINES,
): Insight[] {
  const out: Insight[] = [];
  for (const e of evals) {
    if (e.verdict !== 'leader' || !e.best) continue;
    const def = FACTOR_BY_ID.get(e.factor)!;
    const s = e.best;
    const overallP = e.overall.p ?? 0;
    out.push({
      id: `${e.factor}:${e.metric}:${s.bucket}`,
      factor: e.factor,
      factorLabel: def.label,
      metric: e.metric,
      bucket: s.bucket,
      sentence: sentenceFor(
        e.factor,
        def.label,
        s.bucket,
        e.metric,
        s,
        overallP,
      ),
      x: s.x,
      n: s.n,
      p: s.p ?? 0,
      lo: s.lo,
      hi: s.hi,
      overallP,
      gap: s.lo - overallP,
      exploratory: EXPLORATORY_NOTE,
      confounding: confoundingHint(e.factor, s.dominant),
      searchable: def.searchable,
      diagnostic: e.metric === 'open',
    });
  }
  return out.sort((a, b) => b.gap - a.gap).slice(0, max);
}

// ── is our fit score working? ───────────────────────────────────────────────

export interface StarsCheck {
  warn: boolean;
  message: string | null;
  high: Rate | null;
  low: Rate | null;
}

/** 4-5 star companies should reply more than 1-2 star ones; if not, say so. */
export function starsCheck(rows: BucketRow[]): StarsCheck {
  const sum = (stars: string[]) => {
    const rs = rows.filter((r) => stars.includes(r.bucket));
    return rate(
      rs.reduce((n, r) => n + r.replied, 0),
      rs.reduce((n, r) => n + r.reached, 0),
    );
  };
  const high = sum(['4', '5']);
  const low = sum(['1', '2']);
  if (high.n < MIN_REACHED || low.n < MIN_REACHED) {
    return { warn: false, message: null, high: null, low: null };
  }
  const beats = high.lo > (low.p ?? 0);
  return {
    warn: !beats,
    message: beats
      ? null
      : "Our fit score isn't predicting replies for this offer yet: 4-5 star companies don't clearly reply more than 1-2 star ones.",
    high,
    low,
  };
}

// ── send time honesty ───────────────────────────────────────────────────────

export interface SendTimeStatus {
  comparable: boolean;
  message: string | null;
}

/**
 * Times can only be compared if we actually varied them. If every first-touch
 * email went out in two 2-hour blocks or fewer, we say so and never present a
 * "best time".
 */
export function sendTimeStatus(blocksUsed: number[]): SendTimeStatus {
  const used = [...new Set(blocksUsed)].sort((a, b) => a - b);
  if (used.length === 0) {
    return {
      comparable: false,
      message:
        'No first-touch emails in this view yet, so there is no send-time data.',
    };
  }
  if (used.length <= 2) {
    const where = used.map((b) => BLOCK_LABELS[b]).join(' and ');
    return {
      comparable: false,
      message: `We've only sent between ${where}, so we can't compare times yet. Run a send-time test (T17) to find out.`,
    };
  }
  return { comparable: true, message: null };
}

/**
 * Which metric leads the page: confirmed qualified replies when people have
 * settled at least half of the interested replies, else plain replies.
 */
export function headlineMetric(totals: {
  positive: number;
  qualified: number;
}): 'qualified' | 'reply' {
  return totals.positive > 0 && totals.qualified / totals.positive >= 0.5
    ? 'qualified'
    : 'reply';
}
