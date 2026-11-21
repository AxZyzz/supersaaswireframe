import { srmCheck, twoPropTest } from './stats';
import type { ArmCounts, GateResult, ReviewInput } from './types';

/**
 * Data-quality gates (Learning Loop T04). Each answers "can we trust this
 * read yet?" and returns plain words plus when to look again. A failed gate
 * means "keep collecting" (or, for guardrails, a deliverability warning); it
 * never means a version lost.
 */

export const SRM_P_MIN = 0.001;
export const DELIVERY_P_MIN = 0.01;
export const DELIVERY_GAP_MIN = 0.05;

const day = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);
const pct = (v: number) => `${(v * 100).toFixed(1)}%`;
const plural = (n: number, one: string, many: string) =>
  `${n} ${n === 1 ? one : many}`;

/** 1. Is every company's reply window over, and the decision date reached? */
export function windowMatureGate(input: ReviewInput): GateResult {
  const assigned = input.arms.reduce((n, a) => n + a.assigned, 0);
  const closed = input.arms.reduce((n, a) => n + a.windowClosed, 0);
  const open = assigned - closed;
  const dateReached =
    input.decisionDate === null || input.now >= input.decisionDate;
  if (open <= 0 && dateReached) {
    return {
      id: 'window_mature',
      passed: true,
      reason: 'Every company has had its full reply window.',
      nextCheck: null,
    };
  }
  // the earliest honest read is the later of the two dates we know about
  const dates = [input.earliestFullRead, input.decisionDate].filter(
    (d): d is Date => d !== null,
  );
  const next =
    dates.length > 0
      ? new Date(Math.max(...dates.map((d) => d.getTime())))
      : null;
  const parts: string[] = [];
  if (open > 0) {
    parts.push(
      `${open} of ${assigned} companies are still inside their reply window.`,
    );
  }
  if (!dateReached) {
    parts.push(
      `The decision date (${day(input.decisionDate)}) has not been reached.`,
    );
  }
  if (next) parts.push(`Earliest full read: ${day(next)}.`);
  return {
    id: 'window_mature',
    passed: false,
    reason: parts.join(' '),
    nextCheck: day(next),
  };
}

/** 2. Have people settled enough AI-labelled replies? */
export function outcomeCoverageGate(input: ReviewInput): GateResult {
  if (input.outcomeCoverage >= input.coverageGate) {
    return {
      id: 'outcome_coverage',
      passed: true,
      reason: `${pct(input.outcomeCoverage)} of replying companies have a settled outcome (needed ${pct(input.coverageGate)}).`,
      nextCheck: null,
    };
  }
  const waiting = input.arms.reduce((n, a) => n + a.qualifiedProvisional, 0);
  const n = Math.max(1, waiting);
  return {
    id: 'outcome_coverage',
    passed: false,
    reason: `Only ${pct(input.outcomeCoverage)} of replying companies have a settled outcome (needed ${pct(input.coverageGate)}). Confirm or reject ${plural(n, 'more reply', 'more replies')}.`,
    nextCheck: null,
  };
}

/** 3. Did the companies split between versions the way we planned? (sample-ratio mismatch) */
export function assignmentBalanceGate(input: ReviewInput): GateResult {
  const [a, b] = input.arms;
  const { p } = srmCheck(
    a.assigned,
    b.assigned,
    input.expectedShareControl ?? 0.5,
  );
  if (p >= SRM_P_MIN) {
    return {
      id: 'assignment_balance',
      passed: true,
      reason: `Companies split ${a.assigned} / ${b.assigned}, as planned.`,
      nextCheck: null,
    };
  }
  return {
    id: 'assignment_balance',
    passed: false,
    reason: `Companies split ${a.assigned} / ${b.assigned}, which is far from the planned split (p = ${p.toFixed(4)}). Something is steering companies to one version, so the comparison is not fair.`,
    nextCheck: null,
  };
}

/** 4. Did both versions get delivered about equally? */
export function deliveryBalanceGate(input: ReviewInput): GateResult {
  const [a, b] = input.arms;
  const t = twoPropTest(a.delivered, a.sent, b.delivered, b.sent);
  const gap = Math.abs(t.diff);
  if (t.p < DELIVERY_P_MIN && gap > DELIVERY_GAP_MIN) {
    return {
      id: 'delivery_balance',
      passed: false,
      reason: `Delivery differs between versions (${a.label} ${pct(a.delivered / a.sent)}, ${b.label} ${pct(b.delivered / b.sent)}). A deliverability gap, not the wording, may explain the result.`,
      nextCheck: null,
    };
  }
  return {
    id: 'delivery_balance',
    passed: true,
    reason: 'Both versions were delivered at similar rates.',
    nextCheck: null,
  };
}

/** 5. Could any reply belong to more than one test? */
export function attributionCleanGate(input: ReviewInput): GateResult {
  const n = input.flags.ambiguousAttribution;
  if (n === 0) {
    return {
      id: 'attribution_clean',
      passed: true,
      reason:
        input.flags.unattributedReplies > 0
          ? `${plural(input.flags.unattributedReplies, 'reply', 'replies')} could not be tied to a test and are left out (shown, not counted).`
          : 'Every reply is tied to one test.',
      nextCheck: null,
    };
  }
  return {
    id: 'attribution_clean',
    passed: false,
    reason: `${plural(n, 'reply', 'replies')} could belong to more than one test. Resolve them in the review queue first.`,
    nextCheck: null,
  };
}

/** 6. Was the wording left alone while the test ran? */
export function copyFrozenGate(input: ReviewInput): GateResult {
  if (!input.flags.variantEditedWhileRunning) {
    return {
      id: 'copy_frozen',
      passed: true,
      reason: 'The wording did not change while the test ran.',
      nextCheck: null,
    };
  }
  return {
    id: 'copy_frozen',
    passed: false,
    reason:
      'A version, the offer or the audience changed while the test ran, so the comparison is no longer fair. Start a new test.',
    nextCheck: null,
  };
}

const rate = (x: number, n: number) => (n > 0 ? x / n : 0);

/**
 * 7. Guardrails: bounce < limit (of sent), unsubscribe and complaint < limit
 * (of delivered). A breach is a deliverability problem to fix in send
 * controls; it blocks a winner but is never called a "loss".
 */
export function guardrailsGate(input: ReviewInput): GateResult {
  const g = input.guardrails;
  const breaches: string[] = [];
  for (const a of input.arms) {
    const bounce = rate(a.bounced, a.sent);
    const unsub = rate(a.unsubscribed, a.delivered);
    const complaint = rate(a.complaints, a.delivered);
    if (bounce >= g.bounce) {
      breaches.push(
        `${a.label}: bounces ${pct(bounce)} (limit ${pct(g.bounce)})`,
      );
    }
    if (unsub >= g.unsub) {
      breaches.push(
        `${a.label}: unsubscribes ${pct(unsub)} (limit ${pct(g.unsub)})`,
      );
    }
    if (complaint >= g.complaint) {
      breaches.push(
        `${a.label}: complaints ${(complaint * 100).toFixed(2)}% (limit ${(g.complaint * 100).toFixed(2)}%)`,
      );
    }
  }
  if (breaches.length === 0) {
    return {
      id: 'guardrails',
      passed: true,
      reason: 'Bounces, unsubscribes and complaints are inside the limits.',
      nextCheck: null,
    };
  }
  return {
    id: 'guardrails',
    passed: false,
    reason: `${breaches.join('; ')}. Check sender health and the list before judging the wording.`,
    nextCheck: null,
    warning: 'guardrail_breach',
  };
}

/** 8. Enough companies in each version (and a plan to compare against). */
export function minimumSampleGate(input: ReviewInput): GateResult {
  const empty = input.arms.find((a: ArmCounts) => a.assigned === 0);
  if (empty) {
    return {
      id: 'minimum_sample',
      passed: false,
      reason: `${empty.label} has no companies yet.`,
      nextCheck: null,
    };
  }
  const target = input.targetNPerArm;
  if (target === null) {
    return {
      id: 'minimum_sample',
      passed: true,
      reason: 'No sample plan was set, so only the data-quality gates apply.',
      nextCheck: null,
      warning: 'no sample plan',
    };
  }
  const short = input.arms.filter((a) => a.assigned < target);
  if (short.length === 0) {
    return {
      id: 'minimum_sample',
      passed: true,
      reason: `Each version has at least the planned ${target} companies.`,
      nextCheck: null,
    };
  }
  return {
    id: 'minimum_sample',
    passed: false,
    reason: `Planned ${target} companies per version; ${short
      .map((a) => `${a.label} has ${a.assigned}`)
      .join(', ')}.`,
    nextCheck: null,
  };
}

/** All gates, in the fixed order the UI shows them. */
export function runGates(input: ReviewInput): GateResult[] {
  return [
    windowMatureGate(input),
    outcomeCoverageGate(input),
    assignmentBalanceGate(input),
    deliveryBalanceGate(input),
    attributionCleanGate(input),
    copyFrozenGate(input),
    guardrailsGate(input),
    minimumSampleGate(input),
  ];
}
