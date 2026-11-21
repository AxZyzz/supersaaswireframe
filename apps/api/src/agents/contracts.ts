import Ajv2020 from 'ajv/dist/2020';
import type { ErrorObject, ValidateFunction } from 'ajv/dist/2020';
import copywriterInputSchema from './contracts/copywriter.input.schema.json';
import copywriterOutputSchema from './contracts/copywriter.output.schema.json';
import discoverInputSchema from './contracts/discover.input.schema.json';
import discoverOutputSchema from './contracts/discover.output.schema.json';
import reviewInputSchema from './contracts/review-analyst.input.schema.json';
import reviewOutputSchema from './contracts/review-analyst.output.schema.json';

// The JSON Schemas are the contract with the Python agents (apps/agents). Source of truth:
// packages/shared/src/agents/*.schema.json; `npm run contracts:sync -w apps/api` copies them
// here and contracts.spec.ts fails if the copies drift. The same fixtures are validated by
// apps/agents/tests/test_contracts.py.

// ── Review analyst ──────────────────────────────────────────────────────
export type NextStep =
  'keep_testing' | 'review_challenger' | 'apply_to_next_search' | 'none';

export interface EvidenceFinding {
  id: string;
  kind: 'rate' | 'lift' | 'gate' | 'guardrail' | 'sample_plan' | 'diagnostic';
  [key: string]: unknown;
}

export interface ReviewAnalystInput {
  reviewId: string;
  revision: number;
  simulated: boolean;
  decision: 'keep_collecting' | 'guardrail_breach' | 'promote' | 'inconclusive';
  minLiftPp: number;
  gates: Array<{ id: string; passed: boolean; reason: string }>;
  findings: EvidenceFinding[];
  arms: Array<{
    variantId: string;
    label: string;
    isControl: boolean;
    assigned: number;
    qualifiedVerified: number;
    qualifiedRate: number | null;
  }>;
  allowedActions: Array<{
    type:
      'keep_testing' | 'pause_variant' | 'draft_challenger' | 'test_next_batch';
    label?: string;
  }>;
  slices?: Array<Record<string, unknown>>;
}

export interface ReviewAnalystOutput {
  summary: string;
  points: Array<{ text: string; findingIds: string[] }>;
  caveats: string[];
  suggestedNextStep: NextStep;
}

// ── Copywriter ──────────────────────────────────────────────────────────
export interface CopywriterInput {
  offer: { name: string; description?: string };
  kb: string;
  control: { subject: string };
  currentWinner?: { subject: string };
  losingSubjects: string[];
  constraints: { maxChars: number; keepMergeTokens: boolean; language: string };
  playbooks: string[];
}

export interface CopywriterOutput {
  candidates: Array<{ subject: string; rationale: string }>;
}

// ── Discover (T10) ──────────────────────────────────────────────────────
export type DiscoverMode = 'baseline' | 'targeted';
export type DiscoverFactor =
  'city' | 'industry' | 'trigger' | 'size_band' | 'country' | 'region';

export interface DiscoverInput {
  runId: string;
  orgId: string;
  offer: { id: string; name: string; description?: string };
  seller?: {
    description?: string | null;
    offer?: string | null;
    audience?: string | null;
    painPoints?: string | null;
  };
  goal: string;
  icp?: Record<string, unknown>;
  targetCount: number;
  mode: DiscoverMode;
  preference?: {
    id: string;
    revision: number;
    filter: { factor: DiscoverFactor; value: string };
  };
  excludeCompanyKeys: string[];
}

/** One company the agent claims to have found. A CLAIM: the API re-checks all of it. */
export interface DiscoverCandidate {
  name: string;
  domain: string;
  companyKey: string;
  isRealBusinessSite?: boolean;
  summary?: string;
  evidence: Array<{ fact?: string; quote: string; url: string }>;
  attributes: {
    city?: string;
    region?: string;
    country?: string;
    location?: string;
    industry?: string;
    size_band?: string;
  };
  triggers: Array<{ type: string; quote: string; url: string }>;
  emailsSeen: Array<{ email: string; url: string }>;
  opportunity?: {
    hypothesis?: string;
    service?: string;
    discoveryQuestion?: string;
  };
  unknowns?: string[];
  scores?: {
    icp: number;
    opportunity: number;
    timing: number;
    commercial: number;
  };
  /** The agent's claim. Ignored: the API decides from the verified attributes. */
  matchedPreference: boolean;
}

export interface DiscoverOutput {
  runId: string;
  mode: DiscoverMode;
  candidates: DiscoverCandidate[];
  stats: {
    proposed: number;
    fetched: number;
    verified: number;
    droppedUnverified: number;
    droppedSafety: number;
    preferenceId?: string;
    preferenceRevision?: number;
  };
}

// ── validators ──────────────────────────────────────────────────────────
const ajv = new Ajv2020({ allErrors: true, strict: false });

const compiled = {
  'review-analyst.input': ajv.compile(reviewInputSchema),
  'review-analyst.output': ajv.compile(reviewOutputSchema),
  'copywriter.input': ajv.compile(copywriterInputSchema),
  'copywriter.output': ajv.compile(copywriterOutputSchema),
  'discover.input': ajv.compile(discoverInputSchema),
  'discover.output': ajv.compile(discoverOutputSchema),
} satisfies Record<string, ValidateFunction>;

export type ContractName = keyof typeof compiled;

function describe(errors: ErrorObject[] | null | undefined): string {
  return (errors ?? [])
    .slice(0, 4)
    .map((e) => `${e.instancePath || '(root)'} ${e.message ?? 'invalid'}`)
    .join('; ');
}

/** `null` when the value matches the contract, else a short reason. */
export function contractError(
  name: ContractName,
  data: unknown,
): string | null {
  const validate = compiled[name];
  return validate(data) ? null : describe(validate.errors);
}

export const CONTRACT_SCHEMAS = {
  'review-analyst.input': reviewInputSchema,
  'review-analyst.output': reviewOutputSchema,
  'copywriter.input': copywriterInputSchema,
  'copywriter.output': copywriterOutputSchema,
  'discover.input': discoverInputSchema,
  'discover.output': discoverOutputSchema,
};
