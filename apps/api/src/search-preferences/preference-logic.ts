import { createHash } from 'crypto';
import { newcombeDiff, type DiffInterval } from '../review/policy';

/**
 * Learning Loop T12: the pure rules of a search preference. No database, no
 * AI: the service and the Discover run call these, and unit tests pin them.
 *
 * A preference reserves at most MAX_CAP_SHARE of one Discover batch for one
 * factor value ("expansion", "Pune", "healthcare_clinic"...) for a limited
 * time. Code decides how many slots and whether a company counts; the AI only
 * proposes candidate companies.
 */

/** The factors Discover can search for (the Insights factors marked searchable). */
export const SEARCH_FACTORS = [
  'city',
  'region',
  'country',
  'industry',
  'size_band',
  'trigger',
] as const;
export type SearchFactor = (typeof SEARCH_FACTORS)[number];

export const MAX_CAP_SHARE = 0.2;
export const DEFAULT_EXPIRY_DAYS = 14;
export const MAX_EXPIRY_DAYS = 30;

/** Rollback thresholds (Aman's defaults, 2026-11-20). */
export const BOUNCE_GUARDRAIL = 0.05;
export const COVERAGE_GATE = 0.9;
/** Companies sent before a bounce rate means anything. */
export const MIN_SENT_FOR_GUARDRAIL = 20;
/** Reached companies needed in EACH group before a verdict. */
export const MIN_REACHED_PER_GROUP = 30;
/** Smallest lift worth acting on (2 points), as a fraction. */
export const MIN_LIFT = 0.02;
export const RESPONSE_WINDOW_DAYS = 14;

export const isSearchFactor = (f: unknown): f is SearchFactor =>
  typeof f === 'string' && (SEARCH_FACTORS as readonly string[]).includes(f);

export const FACTOR_LABEL: Record<SearchFactor, string> = {
  city: 'City',
  region: 'State / region',
  country: 'Country',
  industry: 'Industry',
  size_band: 'Company size',
  trigger: 'Buying trigger',
};

const pretty = (v: string) => v.replace(/_/g, ' ');

/** "Buying trigger: expansion". */
export const preferenceLabel = (factor: SearchFactor, value: string) =>
  `${FACTOR_LABEL[factor]}: ${pretty(value)}`;

/**
 * Slots reserved in a batch: floor(batch x share). The small epsilon keeps
 * floating point from turning 15 x 0.2 (3.0000000000000004) or 0.2 x 5 into
 * the wrong whole number.
 */
export function reservedSlots(batchSize: number, capShare: number): number {
  if (!(batchSize > 0) || !(capShare > 0)) return 0;
  return Math.floor(batchSize * Math.min(capShare, MAX_CAP_SHARE) + 1e-9);
}

/** One plain sentence for the constrained candidate prompt. */
export function describeFilter(factor: SearchFactor, value: string): string {
  const v = pretty(value);
  switch (factor) {
    case 'city':
      return `headquartered or based in the city of ${v}`;
    case 'region':
      return `based in the state / region of ${v}`;
    case 'country':
      return `based in ${v}`;
    case 'industry':
      return `operating in the "${v}" industry`;
    case 'size_band':
      return `with about ${value} employees`;
    case 'trigger':
      return `showing a recent public "${v}" buying signal on their website (hiring = open roles; expansion = new location or market; funding = raised money; product_launch = new product)`;
  }
}

/** The part of a checked prospect that decides whether it matches the factor. */
export interface MatchableProspect {
  status: string;
  city: string | null;
  region: string | null;
  country: string | null;
  industry: string | null;
  size_band: string | null;
  triggers: unknown;
}

const norm = (s: string | null | undefined) =>
  (s ?? '').toLowerCase().replace(/\s+/g, ' ').trim();

/**
 * A targeted company counts only if its OWN website confirms the factor:
 * a verified location (city / region / country) or a verified trigger quote.
 * Industry and company size are the model's reading of the site (no quote to
 * check), so they are the weaker kind of match; the UI says so.
 */
export function matchesFactor(
  factor: SearchFactor,
  value: string,
  p: MatchableProspect,
): boolean {
  if (p.status !== 'verified') return false;
  // underscores and spaces are the same word ("healthcare_clinic")
  const same = (a: string | null | undefined) =>
    norm(a).replace(/_/g, ' ') === norm(value).replace(/_/g, ' ');
  switch (factor) {
    case 'city':
      return same(p.city);
    case 'region':
      return same(p.region);
    case 'country':
      return same(p.country);
    case 'industry':
      return same(p.industry);
    case 'size_band':
      return same(p.size_band);
    case 'trigger': {
      const list = Array.isArray(p.triggers) ? p.triggers : [];
      return list.some(
        (t) =>
          !!t && typeof t === 'object' && same((t as { type?: string }).type),
      );
    }
  }
}

/** Identifies one piece of evidence: the same data can't approve a second test. */
export function evidenceHash(e: {
  offerId: string;
  factor: string;
  value: string;
  metric: string;
  x: number;
  n: number;
}): string {
  return createHash('sha256')
    .update(
      [e.offerId, e.factor, e.value, e.metric, e.x, e.n]
        .join('|')
        .toLowerCase(),
    )
    .digest('hex');
}

/** What the run records about how it used the preference. */
export interface Allocation {
  batchSize: number;
  cap: number;
  capShare: number;
  factor: SearchFactor;
  value: string;
  label: string;
  targetedRequested: number;
  targetedFound: number;
  targetedKept: number;
  shortfall: number;
  baselineFilled: number;
  dedupedOverlap: number;
  /** Set when the preference could not be used (for example a tiny batch). */
  skipped?: string;
  finalized?: boolean;
}

/** The sentence under the run header. */
export function allocationLine(a: Allocation): string {
  const pct = Math.round(a.capShare * 100);
  if (a.skipped) return `Preference not used: ${a.skipped}`;
  const base = `${pct}% reserved for ${a.label}: found ${a.targetedKept} of ${a.cap}`;
  if (a.shortfall <= 0) return `${base}.`;
  return `${base}, ${a.baselineFilled} filled from the normal search.`;
}

// ── did it work? ────────────────────────────────────────────────────────────

/** One group of leads (targeted or baseline) from the same runs. Counts are companies. */
export interface ArmStats {
  discovered: number;
  /** Verified, with an email that accepts mail. */
  contactable: number;
  /** Companies with a first-touch email sent. */
  sent: number;
  /** ...and not bounced. */
  reached: number;
  bounced: number;
  /** Human-confirmed qualified replies, within the reply window. */
  qualified: number;
  /** AI-interested replies (confirmed or not). */
  positive: number;
}

export type ResultState =
  'keep_collecting' | 'test_next_batch' | 'apply_temporary' | 'revert';

export interface ResultVerdict {
  state: ResultState;
  /** Plain reasons, one per line. */
  reasons: string[];
  qualifiedPerReached: { targeted: number | null; baseline: number | null };
  diff: DiffInterval | null;
  coverage: number | null;
}

const rate = (x: number, n: number) => (n > 0 ? x / n : null);
const pct1 = (v: number) => `${(v * 100).toFixed(1)}%`;

/**
 * The spec's four states, from the same company-level numbers Review uses:
 *  - revert: a guardrail failed (targeted bounce rate) or the effect reversed;
 *  - keep_collecting: window open, too few reached companies, or replies
 *    still waiting for a person to confirm them;
 *  - apply_temporary: the lift's cautious end clears the minimum worthwhile
 *    lift (offer "extend 14 more days at the same cap");
 *  - test_next_batch: a credible but not yet conclusive lift; repeat with
 *    fresh batches (a new preference after this one ends).
 */
export function decideResults(
  targeted: ArmStats,
  baseline: ArmStats,
  opts: { windowOpen: boolean },
): ResultVerdict {
  const reasons: string[] = [];
  const qT = rate(targeted.qualified, targeted.reached);
  const qB = rate(baseline.qualified, baseline.reached);
  const positive = targeted.positive + baseline.positive;
  const confirmed = targeted.qualified + baseline.qualified;
  const coverage = positive > 0 ? Math.min(1, confirmed / positive) : null;
  const verdict = (
    state: ResultState,
    diff: DiffInterval | null,
  ): ResultVerdict => ({
    state,
    reasons,
    qualifiedPerReached: { targeted: qT, baseline: qB },
    diff,
    coverage,
  });

  // guardrail first: deliverability is never a "loss", but the preference stops
  const bounceRate = rate(targeted.bounced, targeted.sent);
  if (
    targeted.sent >= MIN_SENT_FOR_GUARDRAIL &&
    bounceRate !== null &&
    bounceRate > BOUNCE_GUARDRAIL
  ) {
    reasons.push(
      `Emails to the targeted companies bounced ${pct1(bounceRate)} of the time (limit ${pct1(BOUNCE_GUARDRAIL)}). Check the list and sender health.`,
    );
    return verdict('revert', null);
  }

  const have = Math.min(targeted.reached, baseline.reached);
  if (opts.windowOpen) {
    reasons.push(
      'Some companies are still inside their 14-day reply window, so results can still change.',
    );
  }
  if (have < MIN_REACHED_PER_GROUP) {
    reasons.push(
      `Need at least ${MIN_REACHED_PER_GROUP} reached companies in each group; the smaller group has ${have}.`,
    );
  }
  if (coverage !== null && coverage < COVERAGE_GATE) {
    reasons.push(
      `Only ${pct1(coverage)} of interested replies are confirmed by a person (need ${pct1(COVERAGE_GATE)}).`,
    );
  }
  if (reasons.length > 0) return verdict('keep_collecting', null);

  const diff = newcombeDiff(
    targeted.qualified,
    targeted.reached,
    baseline.qualified,
    baseline.reached,
  );
  if (diff.hi <= -MIN_LIFT) {
    reasons.push(
      'The targeted companies did clearly worse than the normal search.',
    );
    return verdict('revert', diff);
  }
  if (diff.lo >= MIN_LIFT) {
    reasons.push(
      'Targeted companies beat the normal search by at least 2 points even at the cautious end. You can extend this test for 14 more days at the same cap.',
    );
    return verdict('apply_temporary', diff);
  }
  if (diff.d >= MIN_LIFT) {
    reasons.push(
      'A promising difference, but not yet certain. Repeat with fresh batches: approve a new preference once this one ends.',
    );
    return verdict('test_next_batch', diff);
  }
  reasons.push(
    'No clear difference yet. More fresh batches would tell, or leave this factor alone.',
  );
  return verdict('keep_collecting', diff);
}

/**
 * Why a running preference should switch itself off, or null. Two tripwires
 * (the rollback thresholds of the plan): the targeted leads bounce more than
 * the guardrail, or outcome tracking looks broken (after a week, too few of
 * the interested replies from targeted companies are confirmed by a person).
 */
export function autoDeactivateReason(
  targeted: ArmStats,
  _baseline: ArmStats,
  ageDays: number,
): string | null {
  const bounceRate = rate(targeted.bounced, targeted.sent);
  if (
    targeted.sent >= MIN_SENT_FOR_GUARDRAIL &&
    bounceRate !== null &&
    bounceRate > BOUNCE_GUARDRAIL
  ) {
    return `Switched off automatically: emails to the targeted companies bounced ${pct1(bounceRate)} of the time (limit ${pct1(BOUNCE_GUARDRAIL)}).`;
  }
  if (ageDays >= 7 && targeted.positive > 0) {
    const coverage = targeted.qualified / targeted.positive;
    if (coverage < COVERAGE_GATE) {
      return `Switched off automatically: after ${Math.floor(ageDays)} days only ${pct1(coverage)} of the interested replies from targeted companies are confirmed by a person (need ${pct1(COVERAGE_GATE)}), so results cannot be trusted.`;
    }
  }
  return null;
}
