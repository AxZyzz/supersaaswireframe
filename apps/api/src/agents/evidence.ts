import type { ReviewResult } from '../review/policy';
import type { ReviewAnalystInput } from './contracts';

/**
 * The evidence package the Review analyst gets: aggregates only. It is built field by field from
 * a ReviewResult (never spread), so nothing else the result might one day carry can leak to the
 * agent, and the contract schema rejects unknown fields anyway.
 */
export function buildEvidencePackage(
  reviewId: string,
  revision: number,
  result: ReviewResult & { slices?: unknown },
): ReviewAnalystInput {
  const lift = result.findings.find((f) => f.kind === 'lift');
  const minLift = typeof lift?.minLift === 'number' ? lift.minLift : 0.02;
  return {
    reviewId,
    revision,
    simulated: result.simulated,
    decision: result.decision,
    minLiftPp: Math.round(minLift * 1000) / 10,
    gates: result.gates.map((g) => ({
      id: g.id,
      passed: g.passed,
      reason: g.reason,
    })),
    findings: result.findings.map((f) => ({ ...f })),
    arms: result.arms.map((a) => ({
      variantId: a.variantId,
      label: a.label,
      isControl: a.isControl,
      assigned: a.assigned,
      qualifiedVerified: a.qualifiedVerified,
      qualifiedRate: a.qualifiedRate,
    })),
    allowedActions: result.allowedActions.map((a) => ({
      type: a.type,
      label: a.label,
    })),
    ...(Array.isArray(result.slices)
      ? { slices: result.slices as Array<Record<string, unknown>> }
      : {}),
  };
}
