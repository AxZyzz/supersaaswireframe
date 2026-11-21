/**
 * Review policy types (Learning Loop T04). Pure data: no database, no AI, no
 * framework. Every number a user sees in Review comes from this folder.
 */

export const POLICY_VERSION = 'review-policy/1';

/** Counts for one version (arm) of a test. Company level: one company = one unit. */
export interface ArmCounts {
  variantId: string;
  label: string;
  isControl: boolean;
  /** Eligible assigned companies: the primary denominator. */
  assigned: number;
  sent: number;
  delivered: number;
  bounced: number;
  /** Diagnostic only: opens are unreliable (privacy features, scanners). */
  opened: number;
  /** Raw replies (diagnostic). */
  replied: number;
  /** PRIMARY outcome: companies with a human-verified qualified reply inside the window. */
  qualifiedVerified: number;
  /** AI-labelled qualified replies still waiting for a person. */
  qualifiedProvisional: number;
  /** SECONDARY outcome: booked calls. */
  booked: number;
  unsubscribed: number;
  complaints: number;
  /** Assigned companies whose response window has closed. */
  windowClosed: number;
}

export interface Guardrails {
  bounce: number;
  unsub: number;
  complaint: number;
}

export interface ReviewInput {
  experimentId: string;
  /** Used only to make action ids stable per review. Defaults to the experiment id. */
  reviewId?: string;
  policyVersion: string;
  now: Date;
  decisionDate: Date | null;
  /** When the last assigned company's response window closes (null if unknown). */
  earliestFullRead: Date | null;
  baselineRate: number;
  minLiftPp: number;
  targetNPerArm: number | null;
  guardrails: Guardrails;
  /** Share of replying companies that must be settled, e.g. 0.9. */
  coverageGate: number;
  /** From the T03 helper (outcomeCoverage). */
  outcomeCoverage: number;
  /** Exactly 2 in V1. */
  arms: ArmCounts[];
  flags: {
    unattributedReplies: number;
    ambiguousAttribution: number;
    variantEditedWhileRunning: boolean;
  };
  /** Expected share of the control arm in the allocation (default 0.5). */
  expectedShareControl?: number;
  simulated: boolean;
}

export type GateId =
  | 'window_mature'
  | 'outcome_coverage'
  | 'assignment_balance'
  | 'delivery_balance'
  | 'attribution_clean'
  | 'copy_frozen'
  | 'guardrails'
  | 'minimum_sample';

export interface GateResult {
  id: GateId;
  passed: boolean;
  /** Plain words, shown to the user. */
  reason: string;
  /** When to look again (YYYY-MM-DD), or null when only more data helps. */
  nextCheck: string | null;
  /** A non-blocking note (e.g. "no sample plan"). */
  warning?: string;
}

export type DecisionKind =
  'keep_collecting' | 'guardrail_breach' | 'promote' | 'inconclusive';

export type ActionType =
  'keep_testing' | 'pause_variant' | 'draft_challenger' | 'test_next_batch';

export interface AllowedAction {
  /** Stable: hash of review id + type + target. */
  actionId: string;
  type: ActionType;
  /** pause_variant: the version to pause. */
  variantId?: string;
  /** test_next_batch: the factor (T12). */
  factor?: string;
  label: string;
}

export interface ArmReport {
  variantId: string;
  label: string;
  isControl: boolean;
  assigned: number;
  /** PRIMARY: verified qualified companies / assigned companies. */
  qualifiedRate: number | null;
  qualifiedLo: number;
  qualifiedHi: number;
  qualifiedVerified: number;
  qualifiedProvisional: number;
  bookedRate: number | null;
  /** Diagnostics (not used for the decision). */
  qualifiedRateOfDelivered: number | null;
  sent: number;
  delivered: number;
  bounceRate: number | null;
  unsubscribeRate: number | null;
  complaintRate: number | null;
  openRate: number | null;
  replyRate: number | null;
}

export interface LiftReport {
  /** challenger minus control, as a fraction (0.023 = +2.3 points). */
  d: number;
  lo: number;
  hi: number;
  controlId: string;
  challengerId: string;
}

export type FindingKind =
  'rate' | 'lift' | 'gate' | 'guardrail' | 'sample_plan' | 'diagnostic';

/** A plain fact the explanation (template or AI) may cite by id. */
export interface Finding {
  id: string;
  kind: FindingKind;
  [key: string]: unknown;
}

export interface ReviewResult {
  policyVersion: string;
  experimentId: string;
  simulated: boolean;
  decision: DecisionKind;
  /** The version the policy recommends keeping (promote only), else null. */
  winnerVariantId: string | null;
  /** One sentence, plain words. */
  recommendation: string;
  gates: GateResult[];
  failedGates: Array<GateResult['id']>;
  warnings: string[];
  arms: ArmReport[];
  lift: LiftReport | null;
  /** Companies per arm needed to read the observed lift (inconclusive), or null. */
  sampleNeededPerArm: number | null;
  allowedActions: AllowedAction[];
  findings: Finding[];
  /** Shown beside opens / replies everywhere. */
  diagnosticNote: string;
}
