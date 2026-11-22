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
  campaignId: string;
  stepId: string;
  campaignName: string;
  /** What the two arms differ by: copy ('subject') or send time ('send_time', T17). */
  kind: "subject" | "send_time";
  /** Both arms; windowText is set for a send-time test ("Tue-Thu 09:00-11:00 (recipient time)"). */
  arms: { variantId: string; label: string; windowText: string | null }[];
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
  explanation: {
    summary: string;
    points: { text: string; findingIds: string[] }[];
    /** Set when the AI explanation failed the API's checks and the plain template is shown. */
    fallbackReason?: string;
    suggestedNextStep?: string;
    caveats?: string[];
  };
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
    /** The facts an explanation may cite (F1, F2, ...). */
    findings?: { id: string; kind: string; variantId?: string }[];
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

// ── T11: actions (keep, pause, resume, challenger) ──────────────────────────

export type ActionKind = "keep_testing" | "pause_variant" | "resume_variant" | "approve_challenger";

/** One row of the action history (who did what, when, why, before and after). */
export interface ActionRecord {
  id: string;
  reviewId: string;
  experimentId: string;
  revision: number;
  actionId: string;
  type: ActionKind;
  status: string;
  payload: { variantId?: string; variantLabel?: string; challengerSubject?: string };
  reason: string | null;
  requestedBy: { id: string; name: string } | null;
  approvedBy: { id: string; name: string } | null;
  before: unknown;
  after: unknown;
  requestedAt: string;
  appliedAt: string | null;
  revertedAt: string | null;
  revertsActionId: string | null;
  canRevert: boolean;
  replayed: boolean;
}

export interface ChallengerDraft {
  id: string;
  subject: string;
  source: string;
  createdAt: string;
  /** T14: the playbooks this draft was written with ("Used 1 playbook"). */
  playbooks?: { id: string; title: string }[];
}

/** Made when a confirm dialog opens: a repeat of the same request is a no-op. */
export const newKey = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `k-${Date.now()}-${Math.random().toString(16).slice(2)}`;

const post = <T>(path: string, body?: unknown) =>
  api<T>(path, { method: "POST", body: JSON.stringify(body ?? {}) });

export const listReviewActions = (campaignId: string) =>
  api<ActionRecord[]>(`/campaigns/${campaignId}/review/actions`);

export const approveReviewAction = (
  reviewId: string,
  actionId: string,
  body: { revision: number; idempotencyKey: string; reason?: string; draftId?: string },
) => post<ActionRecord>(`/reviews/${reviewId}/actions/${actionId}/approve`, body);

export const resumeVariant = (
  experimentId: string,
  variantId: string,
  body: { revision: number; idempotencyKey: string; reason?: string },
) => post<ActionRecord>(`/experiments/${experimentId}/variants/${variantId}/resume`, body);

export const revertReviewAction = (
  id: string,
  body: { idempotencyKey: string; reason: string },
) => post<ActionRecord>(`/review-actions/${id}/revert`, body);

export const listChallengerDrafts = (reviewId: string) =>
  api<ChallengerDraft[]>(`/reviews/${reviewId}/challenger-drafts`);

export const createChallengerDrafts = (reviewId: string) =>
  post<{ actionId: string; drafts: ChallengerDraft[] }>(`/reviews/${reviewId}/challenger-drafts`);

/** Server error code (e.g. "stale_review") from a failed call, if any. */
export const errorCode = (e: unknown): string | null =>
  (e as { body?: { error?: string } } | null)?.body?.error ?? null;

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
