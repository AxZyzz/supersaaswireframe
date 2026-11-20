import type { Finding, ReviewResult } from './types';

/**
 * Plain-English explanation of a ReviewResult, written from the numbers with
 * no AI. It is the fallback T09's analyst falls back to whenever the model's
 * answer fails validation. Same shape as the AI output:
 * { summary, points: [{ text, findingIds[] }] }.
 */
export interface Explanation {
  summary: string;
  points: Array<{ text: string; findingIds: string[] }>;
}

const pct = (v: number) => `${(v * 100).toFixed(1)}%`;
/** "+2.3 points" / "-0.6 points" (a real minus sign). */
const pts = (v: number) => {
  const s = (v * 100).toFixed(1);
  return `${v < 0 ? '−' : '+'}${s.replace('-', '')} points`;
};
const ptsBare = (v: number) => {
  const s = (v * 100).toFixed(1).replace('-', '');
  return `${v < 0 ? '−' : '+'}${s}`;
};

const rateFindings = (r: ReviewResult) =>
  r.findings.filter((f) => f.kind === 'rate');

const rateText = (f: Finding) =>
  `confirmed qualified replies from ${f.x as number} of ${f.n as number} companies (${f.p === null ? 'no data' : pct(f.p as number)})`;

export function explain(result: ReviewResult): Explanation {
  const points: Explanation['points'] = [];
  // a result always carries both versions' rate findings
  const [control, challenger] = rateFindings(result);
  const lift = result.findings.find((f) => f.kind === 'lift');

  points.push({
    text: `Version ${result.arms[1].label} got ${rateText(challenger)}; version ${result.arms[0].label} got ${rateText(control)}.`,
    findingIds: [challenger.id, control.id],
  });
  if (lift) {
    const d = lift.value as number;
    const lo = lift.lo as number;
    const hi = lift.hi as number;
    const text =
      lo <= 0 && hi >= 0
        ? `The difference is ${pts(d)}, but it could be anywhere from ${ptsBare(lo)} to ${ptsBare(hi)} points, so we can't call a winner yet.`
        : `The difference is ${pts(d)}, and the likely range is ${ptsBare(lo)} to ${ptsBare(hi)} points.`;
    points.push({ text, findingIds: [lift.id] });
  }
  for (const f of result.findings) {
    if (f.kind === 'gate' || f.kind === 'guardrail') {
      points.push({ text: f.reason as string, findingIds: [f.id] });
    }
  }
  const plan = result.findings.find((f) => f.kind === 'sample_plan');
  if (plan) {
    points.push({
      text: `About ${plan.neededPerArm as number} companies per version would settle it; there are ${plan.havePerArm as number} now.`,
      findingIds: [plan.id],
    });
  }
  const diag = result.findings.find((f) => f.kind === 'diagnostic') as Finding;
  points.push({ text: result.diagnosticNote, findingIds: [diag.id] });
  return { summary: result.recommendation, points };
}
