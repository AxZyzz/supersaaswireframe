/**
 * Prospect qualification. Gemini proposes component scores and evidence; this
 * module decides what is kept and computes the rating, so the number is
 * reproducible from stored inputs and never taken from the model as-is.
 *
 *   ICP match 0-30 · service opportunity 0-25 · timing signals 0-20 ·
 *   commercial fit 0-15 · contact readiness 0-10 (computed here, not by AI)
 *   81-100 ★★★★★ · 61-80 ★★★★ · 41-60 ★★★ · 21-40 ★★ · 0-20 ★
 */

export const SCORE_MAX = {
  icp: 30,
  opportunity: 25,
  timing: 20,
  commercial: 15,
  contact: 10,
} as const;
export type ScorePart = keyof typeof SCORE_MAX;
export type ScoreParts = Record<ScorePart, number>;

export interface Evidence {
  fact: string;
  quote: string;
  url: string;
}

export interface ProspectEmail {
  email: string;
  url: string; // page where it appears
  onCompanyDomain: boolean;
  mx: boolean;
}

const clamp = (n: unknown, max: number) => {
  const v = Math.round(Number(n));
  return Number.isFinite(v) ? Math.min(max, Math.max(0, v)) : 0;
};

/** Contact readiness from real, on-site emails only. */
export function contactScore(emails: ProspectEmail[]): number {
  if (emails.some((e) => e.onCompanyDomain && e.mx)) return 10;
  if (emails.some((e) => e.mx)) return 6;
  return 0;
}

export function scoreProspect(
  ai: Partial<Record<Exclude<ScorePart, 'contact'>, unknown>>,
  emails: ProspectEmail[],
): { parts: ScoreParts; total: number; stars: number } {
  const parts: ScoreParts = {
    icp: clamp(ai.icp, SCORE_MAX.icp),
    opportunity: clamp(ai.opportunity, SCORE_MAX.opportunity),
    timing: clamp(ai.timing, SCORE_MAX.timing),
    commercial: clamp(ai.commercial, SCORE_MAX.commercial),
    contact: contactScore(emails),
  };
  const total = Object.values(parts).reduce((a, b) => a + b, 0);
  return { parts, total, stars: starsFor(total) };
}

export function starsFor(total: number): number {
  if (total > 80) return 5;
  if (total > 60) return 4;
  if (total > 40) return 3;
  if (total > 20) return 2;
  return 1;
}

const squash = (s: string) =>
  s
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();

/**
 * Keeps only facts whose quote really appears on the page it cites (case and
 * whitespace insensitive) and whose URL is one we fetched. This is what stops
 * the model from presenting a guess as something the website says.
 */
export function verifyEvidence(
  proposed: unknown,
  pages: { url: string; text: string }[],
): Evidence[] {
  if (!Array.isArray(proposed)) return [];
  const byUrl = new Map(pages.map((p) => [p.url, squash(p.text)]));
  const all = squash(pages.map((p) => p.text).join(' '));
  const out: Evidence[] = [];
  for (const item of proposed) {
    const { fact, quote, url } = (item ?? {}) as Record<string, unknown>;
    if (typeof fact !== 'string' || typeof quote !== 'string') continue;
    const q = squash(quote);
    if (q.length < 12 || q.length > 400) continue;
    const pageText = typeof url === 'string' ? byUrl.get(url) : undefined;
    const source = pageText?.includes(q)
      ? (url as string)
      : all.includes(q)
        ? (pages.find((p) => squash(p.text).includes(q))?.url ?? null)
        : null;
    if (!source) continue;
    out.push({
      fact: fact.trim().slice(0, 300),
      quote: quote.trim().slice(0, 400),
      url: source,
    });
    if (out.length >= 6) break;
  }
  return out;
}

const strList = (v: unknown, max: number) =>
  Array.isArray(v)
    ? v
        .filter((x): x is string => typeof x === 'string' && x.trim() !== '')
        .map((x) => x.trim().slice(0, 300))
        .slice(0, max)
    : [];

export function cleanOpportunity(v: unknown) {
  const o = (v ?? {}) as Record<string, unknown>;
  const str = (k: string) =>
    typeof o[k] === 'string' ? o[k].trim().slice(0, 500) : '';
  const out = {
    hypothesis: str('hypothesis'),
    service: str('service'),
    discoveryQuestion: str('discoveryQuestion'),
  };
  return out.hypothesis ? out : null;
}

export const cleanUnknowns = (v: unknown) => strList(v, 5);
