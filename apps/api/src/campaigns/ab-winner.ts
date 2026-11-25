/**
 * Self-optimising campaigns: which subject version is winning?
 *
 * Judged on REPLIES (opens are unreliable: Apple Mail prefetch, bot scanners).
 * Each version's reply rate gets a Beta(1 + replies, 1 + non-replies)
 * posterior; we sample them and count how often each version comes out on
 * top. That "probability to be best" is honest with small numbers: 2/10 vs
 * 1/10 doesn't look like a sure thing.
 *
 * A switch is only SUGGESTED (never automatic) when every version has at
 * least MIN_SENDS sends and one is >= CONFIDENCE likely best. The user
 * approves; then the remaining leads get the winner.
 */

export const MIN_SENDS = 20;
export const CONFIDENCE = 0.9;
const SAMPLES = 6000;

export interface VariantStats {
  index: number;
  subject: string;
  sent: number;
  replies: number;
  opens: number;
}

/** Deterministic PRNG (mulberry32) so the same numbers give the same answer. */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Gamma(k, 1) sample (Marsaglia-Tsang; k >= 1 here since priors add 1). */
function gamma(k: number, rand: () => number): number {
  const d = k - 1 / 3;
  const c = 1 / Math.sqrt(9 * d);
  for (;;) {
    let x: number;
    let v: number;
    do {
      // standard normal via Box-Muller
      const u1 = rand() || 1e-12;
      const u2 = rand();
      x = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
      v = 1 + c * x;
    } while (v <= 0);
    v = v * v * v;
    const u = rand();
    if (u < 1 - 0.0331 * x ** 4) return d * v;
    if (Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v;
  }
}

function beta(a: number, b: number, rand: () => number) {
  const x = gamma(a, rand);
  const y = gamma(b, rand);
  return x / (x + y);
}

/** P(each version has the highest true reply rate). */
export function probabilityBest(variants: VariantStats[]): number[] {
  if (variants.length === 0) return [];
  const seed =
    variants.reduce((s, v) => s * 31 + v.sent * 7 + v.replies, 17) >>> 0;
  const rand = rng(seed);
  const wins = new Array<number>(variants.length).fill(0);
  for (let i = 0; i < SAMPLES; i++) {
    let best = 0;
    let bestVal = -1;
    variants.forEach((v, j) => {
      const s = beta(1 + v.replies, 1 + Math.max(0, v.sent - v.replies), rand);
      if (s > bestVal) {
        bestVal = s;
        best = j;
      }
    });
    wins[best]++;
  }
  return wins.map((w) => w / SAMPLES);
}

export interface WinnerAdvice {
  variants: (VariantStats & { replyRate: number; probBest: number })[];
  suggestion: { index: number; probBest: number } | null;
  reason: string;
}

export function adviseWinner(variants: VariantStats[]): WinnerAdvice {
  const probs = probabilityBest(variants);
  const rows = variants.map((v, i) => ({
    ...v,
    replyRate: v.sent ? v.replies / v.sent : 0,
    probBest: Math.round(probs[i] * 1000) / 1000,
  }));
  const top = rows.reduce<(typeof rows)[number] | null>(
    (a, b) => (!a || b.probBest > a.probBest ? b : a),
    null,
  );
  const letter = (i: number) => String.fromCharCode(65 + i);
  const short = rows.filter((r) => r.sent < MIN_SENDS);
  if (rows.length < 2) {
    return { variants: rows, suggestion: null, reason: 'Only one version.' };
  }
  if (short.length) {
    return {
      variants: rows,
      suggestion: null,
      reason: `Keep testing: each version needs ${MIN_SENDS} sends before we judge (${short
        .map((r) => `${letter(r.index)} has ${r.sent}`)
        .join(', ')}).`,
    };
  }
  if (rows.every((r) => r.replies === 0)) {
    return {
      variants: rows,
      suggestion: null,
      reason: 'Keep testing: no replies yet, and replies are what we judge on.',
    };
  }
  if (top && top.probBest >= CONFIDENCE) {
    return {
      variants: rows,
      suggestion: { index: top.index, probBest: top.probBest },
      reason: `Version ${letter(top.index)} is the best by replies with ${Math.round(
        top.probBest * 100,
      )}% probability.`,
    };
  }
  return {
    variants: rows,
    suggestion: null,
    reason: `No clear winner yet (best is ${top ? letter(top.index) : '?'} at ${Math.round(
      (top?.probBest ?? 0) * 100,
    )}%, we wait for ${Math.round(CONFIDENCE * 100)}%).`,
  };
}
