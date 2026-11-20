import { api } from "./api";

/** Learning Loop T05: the read-only Review of an A/B test. */

export type Decision = "keep_collecting" | "guardrail_breach" | "promote" | "inconclusive";

export interface Gate {
  id: string;
  passed: boolean;
  reason: string;
  nextCheck: string | null;
  warning?: string;
}

/** Counts the policy was given for one version (the source of every number). */
export interface ArmCounts {
  variantId: string;
  label: string;
  isControl: boolean;
  assigned: number;
  sent: number;
  delivered: number;
  bounced: number;
  opened: number;
  replied: number;
  qualifiedVerified: number;
  qualifiedProvisional: number;
  booked: number;
  unsubscribed: number;
  complaints: number;
  windowClosed: number;
}

/** Rates the policy computed for one version. */
export interface ArmReport {
  variantId: string;
  label: string;
  isControl: boolean;
  assigned: number;
  qualifiedRate: number | null;
  qualifiedLo: number;
  qualifiedHi: number;
  bounceRate: number | null;
  unsubscribeRate: number | null;
  openRate: number | null;
}

export interface Lift {
  d: number;
  lo: number;
  hi: number;
  controlId: string;
  challengerId: string;
}

export interface SliceBucket {
  value: string;
  assigned: number;
  arms: { variantId: string; assigned: number; qualified: number; rate: number | null }[];
}
export interface Slice {
  factor: "city" | "industry" | "trigger";
  buckets: SliceBucket[];
}

export interface ReviewAction {
  actionId: string;
  type: "keep_testing" | "pause_variant" | "draft_challenger" | "test_next_batch";
  label: string;
  variantId?: string;
}

export interface ExperimentMeta {
  id: string;
  campaignName: string;
  status: string;
  offerName: string | null;
  responseWindowDays: number;
  decisionDate: string | null;
  startedAt: string | null;
  minLiftPp: number;
}

export interface Review {
  id: string;
  experimentId: string | null;
  revision: number;
  simulated: boolean;
  scenario: string | null;
  computedAt: string;
  policyVersion: string;
  explanationSource: string;
  explanation: { summary: string; points: { text: string; findingIds: string[] }[] };
  result: {
    decision: Decision;
    winnerVariantId: string | null;
    recommendation: string;
    gates: Gate[];
    failedGates: string[];
    warnings: string[];
    arms: ArmReport[];
    lift: Lift | null;
    sampleNeededPerArm: number | null;
    allowedActions: ReviewAction[];
    diagnosticNote: string;
    slices: Slice[];
  };
  inputs: { arms: ArmCounts[]; minLiftPp: number };
  experiment: ExperimentMeta | null;
  note: string | null;
}

export interface Scenario {
  id: string;
  label: string;
  blurb: string;
}

export const getCampaignReview = (campaignId: string) =>
  api<Review>(`/campaigns/${campaignId}/review`);

export const refreshCampaignReview = (campaignId: string) =>
  api<Review & { changed: boolean }>(`/campaigns/${campaignId}/review/refresh`, {
    method: "POST",
  });

export const listScenarios = () => api<Scenario[]>("/review/scenarios");

export const simulateReview = (scenario: string) =>
  api<Review>("/review/simulate", {
    method: "POST",
    body: JSON.stringify({ scenario }),
  });

// ── display helpers ────────────────────────────────────────────────────────

/** 0.043 -> "4.3%"; null -> "–". */
export const pct = (v: number | null | undefined, digits = 1) =>
  v === null || v === undefined ? "–" : `${(v * 100).toFixed(digits)}%`;

/** 0.023 -> "+2.3"; -0.006 -> "−0.6" (a real minus sign). */
export const signedPts = (v: number) => {
  const s = Math.abs(v * 100).toFixed(1);
  return `${v < 0 ? "−" : "+"}${s}`;
};

export type StatusKey = "collecting" | "ready" | "inconclusive" | "winner" | "guardrail";

export const STATUS_LABEL: Record<StatusKey, string> = {
  collecting: "Collecting",
  ready: "Ready to decide",
  inconclusive: "Inconclusive",
  winner: "Winner found",
  guardrail: "Guardrail issue",
};

/**
 * The pill: "Ready to decide" means the data is complete (every reply window
 * is over) but a check, usually confirming replies, still blocks a verdict.
 */
export function statusOf(r: Review["result"]): StatusKey {
  if (r.decision === "guardrail_breach") return "guardrail";
  if (r.decision === "promote") return "winner";
  if (r.decision === "inconclusive") return "inconclusive";
  const windowOk = r.gates.find((g) => g.id === "window_mature")?.passed;
  return windowOk ? "ready" : "collecting";
}

export const FACTOR_LABEL: Record<Slice["factor"], string> = {
  city: "City",
  industry: "Industry",
  trigger: "Buying trigger",
};

export const prettyValue = (v: string) =>
  v === "unknown" || v === "other" ? v : v.replace(/_/g, " ");
