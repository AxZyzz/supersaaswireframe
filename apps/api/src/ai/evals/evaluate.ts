import { TEMPLATE_VARS } from '../../templates/render';
import type { ReplyClass } from '../prompts';
import type { ClassifyCase, SequenceCase } from './fixtures';

/** Pure scoring for the AI eval set — no provider, no I/O, so it unit-tests. */

export interface ClassifyOutcome {
  id: string;
  expected: ReplyClass;
  got: string | null;
  ok: boolean;
}

export function scoreClassification(
  cases: ClassifyCase[],
  predictions: Record<string, string | null>,
) {
  const outcomes: ClassifyOutcome[] = cases.map((c) => {
    const got = predictions[c.id] ?? null;
    const ok =
      got === c.expected ||
      (!!got && (c.alsoOk ?? []).includes(got as ReplyClass));
    return { id: c.id, expected: c.expected, got, ok };
  });
  const byClass: Record<string, { total: number; correct: number }> = {};
  for (const o of outcomes) {
    byClass[o.expected] ??= { total: 0, correct: 0 };
    byClass[o.expected].total++;
    if (o.ok) byClass[o.expected].correct++;
  }
  const correct = outcomes.filter((o) => o.ok).length;
  return {
    accuracy: cases.length ? correct / cases.length : 0,
    correct,
    total: cases.length,
    byClass,
    misses: outcomes.filter((o) => !o.ok),
  };
}

export interface GeneratedStep {
  subject: string;
  body: string;
  delayHours: number;
}

// Classic spam-filter triggers; one hit is enough to flag a draft.
const SPAM_PHRASES = [
  'act now',
  '100% free',
  'risk-free',
  'guaranteed',
  'click here',
  'limited time',
  'winner',
  'congratulations',
  '$$$',
  'no obligation',
  'urgent',
];

const TOKEN = /\{(\w+)(?:\|[^}]*)?\}/g;

/** Structural + deliverability checks for one generated sequence. Returns a
 *  list of problems (empty = pass). */
export function checkSequence(
  c: SequenceCase,
  steps: GeneratedStep[],
): string[] {
  const issues: string[] = [];
  if (steps.length !== c.steps) {
    issues.push(`expected ${c.steps} steps, got ${steps.length}`);
  }
  if (steps[0] && steps[0].delayHours !== 0) {
    issues.push('first step should send immediately (delayHours 0)');
  }
  for (let i = 1; i < steps.length; i++) {
    if (steps[i].delayHours <= steps[i - 1].delayHours) {
      issues.push(`step ${i + 1} delay must be later than step ${i}`);
    }
  }
  let usesToken = false;
  steps.forEach((s, i) => {
    const n = i + 1;
    if (!s.subject?.trim()) issues.push(`step ${n} has no subject`);
    if (s.subject && s.subject.length > 80)
      issues.push(`step ${n} subject over 80 chars`);
    const words = (s.body ?? '').trim().split(/\s+/).filter(Boolean).length;
    if (words < 15) issues.push(`step ${n} body too short (${words} words)`);
    if (words > 220) issues.push(`step ${n} body too long (${words} words)`);
    const text = `${s.subject} ${s.body}`.toLowerCase();
    for (const p of SPAM_PHRASES) {
      if (text.includes(p))
        issues.push(`step ${n} contains spam phrase "${p}"`);
    }
    for (const m of `${s.subject} ${s.body}`.matchAll(TOKEN)) {
      if ((TEMPLATE_VARS as readonly string[]).includes(m[1])) usesToken = true;
      else issues.push(`step ${n} uses unknown token {${m[1]}}`);
    }
  });
  if (steps.length && !usesToken) issues.push('no personalization tokens used');
  return issues;
}
