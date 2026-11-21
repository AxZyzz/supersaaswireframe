import {
  contractError,
  type EvidenceFinding,
  type NextStep,
  type ReviewAnalystInput,
  type ReviewAnalystOutput,
} from './contracts';

// The API does not trust the Review analyst. Code made the decision; the agent only explains it,
// and every claim is checked here before a person sees it. Any failure means the deterministic
// template explanation is used instead (explanation_source='template' + the reason).

export type ExplanationCheck =
  | { ok: true; explanation: ReviewAnalystOutput }
  | { ok: false; reason: string };

const MAX_SUMMARY_WORDS = 80;
const NUMBER_TOLERANCE = 0.1;

/** Words that claim a result. Allowed only when the decision is `promote`, or negated. */
const CLAIM_WORDS =
  /\b(winner|winning|proved|proves|proven|significant(?:ly)?)\b/gi;
const NEGATION = /\b(no|not|never|cannot|can't|isn't|aren't|without|nor)\b/i;

const FINDING_ID_IN_TEXT = /\bF\d+\b/g;
const NUMBER = /[-−+]?\d{1,3}(?:,\d{3})+(?:\.\d+)?|[-−+]?\d+(?:\.\d+)?/g;

/** Numbers written in a text, as plain JS numbers (sign dropped: "−2.1" is 2.1). */
export function numbersIn(text: string): number[] {
  const out: number[] = [];
  for (const m of text.replace(FINDING_ID_IN_TEXT, ' ').matchAll(NUMBER)) {
    const n = Number(m[0].replace(/[,+]/g, '').replace('−', '-'));
    if (Number.isFinite(n)) out.push(Math.abs(n));
  }
  return out;
}

/** Every value a finding supports: each number, that number as a percentage, and numbers inside its text. */
function valuesOf(node: unknown, into: Set<number>): void {
  if (typeof node === 'number' && Number.isFinite(node)) {
    into.add(Math.abs(node));
    into.add(Math.abs(node) * 100); // 0.025 -> 2.5 (%), 0.017 -> 1.7 (points)
  } else if (typeof node === 'string') {
    for (const n of numbersIn(node)) into.add(n);
  } else if (Array.isArray(node)) {
    for (const x of node) valuesOf(x, into);
  } else if (node && typeof node === 'object') {
    for (const [k, v] of Object.entries(node)) {
      if (k !== 'id') valuesOf(v, into);
    }
  }
}

function supports(allowed: Set<number>, n: number): boolean {
  for (const a of allowed) {
    if (Math.abs(a - n) <= NUMBER_TOLERANCE) return true;
  }
  return false;
}

/** First number in `text` that none of `findings` supports, else null. */
export function unsupportedNumber(
  text: string,
  findings: Array<EvidenceFinding | Record<string, unknown>>,
  extra: unknown[] = [],
): number | null {
  const allowed = new Set<number>();
  for (const f of findings) valuesOf(f, allowed);
  for (const e of extra) valuesOf(e, allowed);
  for (const n of numbersIn(text)) {
    if (!supports(allowed, n)) return n;
  }
  return null;
}

function nextStepAllowed(step: NextStep, input: ReviewAnalystInput): boolean {
  const has = (t: string) => input.allowedActions.some((a) => a.type === t);
  switch (step) {
    case 'keep_testing':
      return has('keep_testing');
    case 'review_challenger':
      return has('draft_challenger');
    case 'apply_to_next_search':
      return has('test_next_batch');
    case 'none':
      return true;
  }
}

function claimWordProblem(text: string): string | null {
  for (const m of text.matchAll(CLAIM_WORDS)) {
    const before = text.slice(Math.max(0, (m.index ?? 0) - 40), m.index ?? 0);
    if (!NEGATION.test(before)) return m[0];
  }
  return null;
}

export function validateExplanation(
  output: unknown,
  input: ReviewAnalystInput,
): ExplanationCheck {
  // 1. schema
  const schemaError = contractError('review-analyst.output', output);
  if (schemaError) return { ok: false, reason: `schema: ${schemaError}` };
  const out = output as ReviewAnalystOutput;

  if (out.summary.trim().split(/\s+/).length > MAX_SUMMARY_WORDS) {
    return {
      ok: false,
      reason: `summary is longer than ${MAX_SUMMARY_WORDS} words`,
    };
  }

  // 2. every cited finding exists
  const byId = new Map(input.findings.map((f) => [f.id, f]));
  for (const p of out.points) {
    for (const id of p.findingIds) {
      if (!byId.has(id))
        return { ok: false, reason: `cites unknown finding ${id}` };
    }
  }

  // 3. every number matches a cited finding (summary and caveats: any finding)
  for (const p of out.points) {
    const bad = unsupportedNumber(
      p.text,
      p.findingIds.map((id) => byId.get(id) as EvidenceFinding),
    );
    if (bad !== null) {
      return {
        ok: false,
        reason: `number ${bad} is not in the cited findings (${p.findingIds.join(', ')})`,
      };
    }
  }
  const everything = [input.findings, input.arms, input.minLiftPp];
  for (const t of [out.summary, ...out.caveats]) {
    const bad = unsupportedNumber(t, [], everything);
    if (bad !== null) {
      return { ok: false, reason: `number ${bad} is not in the evidence` };
    }
  }

  // 4. claim words only when the decision allows them
  if (input.decision !== 'promote') {
    for (const t of [
      out.summary,
      ...out.points.map((p) => p.text),
      ...out.caveats,
    ]) {
      const word = claimWordProblem(t);
      if (word) {
        return {
          ok: false,
          reason: `says "${word}" but the decision is ${input.decision}`,
        };
      }
    }
  }

  // 5. suggested next step is one the review actually allows
  if (!nextStepAllowed(out.suggestedNextStep, input)) {
    return {
      ok: false,
      reason: `suggested step ${out.suggestedNextStep} is not an allowed action`,
    };
  }

  return { ok: true, explanation: out };
}
