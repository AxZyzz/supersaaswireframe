import { createHash } from 'crypto';
import { runGates } from './gates';
import { newcombeDiff, sampleSizePerArm, wilson } from './stats';
import type {
  ActionType,
  AllowedAction,
  ArmCounts,
  ArmReport,
  DecisionKind,
  Finding,
  GateResult,
  ReviewInput,
  ReviewResult,
} from './types';

export const DIAGNOSTIC_NOTE =
  'Diagnostic: opens are unreliable because of mail privacy features and link scanners. They are shown, never used to decide.';

/** Not worth continuing when the sample still needed is more than this many times what we have. */
export const WORTH_CONTINUING_FACTOR = 3;

const ratio = (x: number, n: number) => (n > 0 ? x / n : null);

function armReport(a: ArmCounts): ArmReport {
  const w = wilson(a.qualifiedVerified, a.assigned);
  return {
    variantId: a.variantId,
    label: a.label,
    isControl: a.isControl,
    assigned: a.assigned,
    qualifiedRate: w.p,
    qualifiedLo: w.lo,
    qualifiedHi: w.hi,
    qualifiedVerified: a.qualifiedVerified,
    qualifiedProvisional: a.qualifiedProvisional,
    bookedRate: ratio(a.booked, a.assigned),
    qualifiedRateOfDelivered: ratio(a.qualifiedVerified, a.delivered),
    sent: a.sent,
    delivered: a.delivered,
    bounceRate: ratio(a.bounced, a.sent),
    unsubscribeRate: ratio(a.unsubscribed, a.delivered),
    complaintRate: ratio(a.complaints, a.delivered),
    openRate: ratio(a.opened, a.delivered),
    replyRate: ratio(a.replied, a.delivered),
  };
}

const actionId = (reviewId: string, type: ActionType, target?: string) =>
  createHash('sha256')
    .update(`${reviewId}:${type}:${target ?? ''}`)
    .digest('hex')
    .slice(0, 16);

/**
 * The decision. Pure: the same input always gives the same output. Code
 * decides; AI may only explain this result. Exactly one of:
 *  - guardrail_breach: bounces / unsubscribes / complaints over the limit
 *    (checked first: it is urgent and valid on early data);
 *  - keep_collecting: a data-quality gate has not passed yet;
 *  - promote: every gate passed and the lift's lower bound clears the minimum
 *    worthwhile lift (or the challenger is clearly worse: keep the control);
 *  - inconclusive: every gate passed but the interval spans values that would
 *    change the decision.
 * It never forces a loser: pausing is only ever a proposed action.
 */
export function decide(input: ReviewInput): ReviewResult {
  if (input.arms.length !== 2) {
    throw new Error('A review compares exactly 2 versions');
  }
  const control = input.arms.find((a) => a.isControl) ?? input.arms[0];
  const challenger = input.arms.find((a) => a !== control) as ArmCounts;
  const reviewId = input.reviewId ?? input.experimentId;
  const minLift = input.minLiftPp / 100;

  const gates = runGates(input);
  const failed: GateResult[] = gates.filter((g) => !g.passed);
  const guardrailFailed = failed.some((g) => g.id === 'guardrails');
  const otherFailed = failed.filter((g) => g.id !== 'guardrails');
  const warnings = [
    ...new Set(gates.flatMap((g) => (g.warning ? [g.warning] : []))),
  ];

  const lift =
    control.assigned > 0 && challenger.assigned > 0
      ? {
          ...newcombeDiff(
            challenger.qualifiedVerified,
            challenger.assigned,
            control.qualifiedVerified,
            control.assigned,
          ),
          controlId: control.variantId,
          challengerId: challenger.variantId,
        }
      : null;

  let decision: DecisionKind;
  let winnerVariantId: string | null = null;
  let recommendation: string;
  let sampleNeededPerArm: number | null = null;
  let worthContinuing = true;

  if (guardrailFailed) {
    decision = 'guardrail_breach';
    recommendation =
      'No winner. A deliverability limit was crossed, so check sender health and the list before judging the wording.';
  } else if (otherFailed.length > 0) {
    decision = 'keep_collecting';
    const more =
      otherFailed.length > 1
        ? ` (and ${otherFailed.length - 1} more checks)`
        : '';
    recommendation = `Keep collecting. ${otherFailed[0].reason}${more}`;
  } else if (lift!.lo >= minLift) {
    // (minimum_sample fails whenever an arm is empty, so a lift exists here)
    decision = 'promote';
    winnerVariantId = challenger.variantId;
    recommendation = `Keep ${challenger.label}: its lift over ${control.label} is at least ${input.minLiftPp} points even at the cautious end.`;
  } else if (lift!.hi <= -minLift) {
    decision = 'promote';
    winnerVariantId = control.variantId;
    recommendation = `Keep ${control.label} and pause ${challenger.label}: ${challenger.label} is worse by at least ${input.minLiftPp} points even at the generous end.`;
  } else {
    decision = 'inconclusive';
    const needed = sampleSizePerArm({
      baseline: input.baselineRate,
      targetLift: lift!.d,
      minLift,
      rule: 'lower_bound',
    }).n;
    const have = Math.min(control.assigned, challenger.assigned);
    sampleNeededPerArm = Number.isFinite(needed) ? needed : null;
    worthContinuing =
      sampleNeededPerArm !== null &&
      sampleNeededPerArm <= WORTH_CONTINUING_FACTOR * have;
    recommendation = worthContinuing
      ? `No clear winner yet. Keep ${control.label}. About ${sampleNeededPerArm} companies per version would settle it.`
      : `No clear winner, and more of the same is not worth it at this volume. Keep ${control.label} and try a new challenger.`;
  }

  // Allowed actions. Pausing is only proposed, and only after a clear result.
  const act = (
    type: ActionType,
    label: string,
    variantId?: string,
  ): AllowedAction => ({
    actionId: actionId(reviewId, type, variantId),
    type,
    ...(variantId ? { variantId } : {}),
    label,
  });
  const allowedActions: AllowedAction[] = [];
  if (decision === 'promote') {
    const loser = winnerVariantId === control.variantId ? challenger : control;
    allowedActions.push(
      act(
        'pause_variant',
        `Pause ${loser.label} for future first touches`,
        loser.variantId,
      ),
      act('draft_challenger', 'Draft a new challenger to test next'),
    );
  } else {
    allowedActions.push(act('keep_testing', 'Keep testing'));
    if (decision === 'inconclusive' && !worthContinuing) {
      allowedActions.push(
        act('draft_challenger', 'Draft a new challenger to test next'),
      );
    }
  }

  // Findings: plain facts, each with a stable id, for the explanation to cite.
  const findings: Finding[] = [];
  const add = (f: { kind: Finding['kind']; [key: string]: unknown }) =>
    findings.push({ ...f, id: `F${findings.length + 1}` });
  for (const a of [control, challenger]) {
    const w = wilson(a.qualifiedVerified, a.assigned);
    add({
      kind: 'rate',
      variantId: a.variantId,
      label: a.label,
      isControl: a.isControl,
      x: a.qualifiedVerified,
      n: a.assigned,
      p: w.p,
      lo: w.lo,
      hi: w.hi,
    });
  }
  if (lift) {
    add({
      kind: 'lift',
      value: lift.d,
      lo: lift.lo,
      hi: lift.hi,
      armA: challenger.variantId,
      armB: control.variantId,
      minLift,
    });
  }
  for (const g of failed) {
    add({
      kind: g.id === 'guardrails' ? 'guardrail' : 'gate',
      gate: g.id,
      reason: g.reason,
      nextCheck: g.nextCheck,
    });
  }
  if (sampleNeededPerArm !== null) {
    add({
      kind: 'sample_plan',
      neededPerArm: sampleNeededPerArm,
      havePerArm: Math.min(control.assigned, challenger.assigned),
    });
  }
  add({
    kind: 'diagnostic',
    note: DIAGNOSTIC_NOTE,
    arms: [control, challenger].map((a) => ({
      variantId: a.variantId,
      opened: a.opened,
      replied: a.replied,
      delivered: a.delivered,
    })),
  });

  return {
    policyVersion: input.policyVersion,
    experimentId: input.experimentId,
    simulated: input.simulated,
    decision,
    winnerVariantId,
    recommendation,
    gates,
    failedGates: failed.map((g) => g.id),
    warnings,
    arms: [armReport(control), armReport(challenger)],
    lift,
    sampleNeededPerArm,
    allowedActions,
    findings,
    diagnosticNote: DIAGNOSTIC_NOTE,
  };
}
