import type { AIModelTier } from '../providers/ai-provider';

// Every AI call states a task. The catalogue is the single place that says how
// each task is run: default tier, output cap, timeout, whether the router may
// fall back to another model, and whether its output is screened before a
// person sees it (Model Armor `screenOutput`).
export const AI_TASKS = [
  'reply_classify',
  'reply_draft',
  'template_edit',
  'campaign_build',
  'discover_plan',
  'discover_verify_extract',
  'review_explain',
  'challenger_draft',
  'playbook_draft',
  'import_column_match',
] as const;
export type AiTask = (typeof AI_TASKS)[number];

export interface TaskSpec {
  tier: AIModelTier;
  maxOutputTokens: number;
  jsonSchema?: Record<string, unknown>;
  timeoutMs: number;
  allowFallback: boolean;
  /** AI text a person will read or send: screened by Model Armor. */
  screenOutput: boolean;
  /** Never refused by the daily budget (classification never blocks). */
  essential: boolean;
}

const T = 45_000; // matches the long-standing GEMINI_TIMEOUT_MS default

function spec(
  tier: AIModelTier,
  maxOutputTokens: number,
  extra: Partial<TaskSpec> = {},
): TaskSpec {
  return {
    tier,
    maxOutputTokens,
    timeoutMs: T,
    allowFallback: true,
    screenOutput: false,
    essential: false,
    ...extra,
  };
}

export const TASK_CATALOGUE: Record<AiTask, TaskSpec> = {
  reply_classify: spec('fast', 300, { essential: true }),
  reply_draft: spec('balanced', 800, { screenOutput: true }),
  template_edit: spec('balanced', 800, { screenOutput: true }),
  campaign_build: spec('powerful', 4000, { screenOutput: true }),
  discover_plan: spec('balanced', 3000),
  discover_verify_extract: spec('fast', 2000),
  review_explain: spec('balanced', 1200, { screenOutput: true }),
  challenger_draft: spec('powerful', 400, { screenOutput: true }),
  // T14: rewording of a playbook a person will read, edit and save (screened like other drafts)
  // A person is waiting in a dialog, and the template is the fallback: fail fast.
  playbook_draft: spec('fast', 500, { screenOutput: true, timeoutMs: 8_000 }),
  import_column_match: spec('fast', 1000),
};

/** ai_usage.feature (kept stable: plan limits count it) → the task it runs. */
export const FEATURE_TASK: Record<string, AiTask> = {
  'reply-classify': 'reply_classify',
  'reply-draft': 'reply_draft',
  'refine-email': 'template_edit',
  'sequence-gen': 'campaign_build',
  'prospect-icp': 'discover_plan',
  'prospect-research': 'discover_verify_extract',
  'challenger-draft': 'challenger_draft',
  'playbook-draft': 'playbook_draft',
  'review-explain': 'review_explain',
  'map-columns': 'import_column_match',
};

export function isAiTask(v: unknown): v is AiTask {
  return typeof v === 'string' && (AI_TASKS as readonly string[]).includes(v);
}
