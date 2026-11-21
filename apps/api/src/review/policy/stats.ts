/**
 * Statistics for the Review policy (Learning Loop T04). Pure functions.
 *
 * - Wilson score interval for one proportion.
 * - Newcombe hybrid score interval (method 10) for the DIFFERENCE of two
 *   independent proportions (Newcombe 1998, Statistics in Medicine 17:873).
 * - Sample size per arm, two rules.
 * - Sample-ratio-mismatch (chi-square, 1 df) and a two-proportion z-test.
 */

// ── normal distribution ─────────────────────────────────────────────────────

/** Complementary error function (Numerical Recipes erfcc, fractional error < 1.2e-7). */
function erfc(x: number): number {
  const z = Math.abs(x);
  const t = 1 / (1 + 0.5 * z);
  const r =
    t *
    Math.exp(
      -z * z -
        1.26551223 +
        t *
          (1.00002368 +
            t *
              (0.37409196 +
                t *
                  (0.09678418 +
                    t *
                      (-0.18628806 +
                        t *
                          (0.27886807 +
                            t *
                              (-1.13520398 +
                                t *
                                  (1.48851587 +
                                    t * (-0.82215223 + t * 0.17087277)))))))),
    );
  return x >= 0 ? r : 2 - r;
}

/** Standard normal CDF. */
export function normCdf(x: number): number {
  return 1 - 0.5 * erfc(x / Math.SQRT2);
}

/**
 * Inverse standard normal CDF: Acklam's rational approximation (relative
 * error ~1.2e-9). Throws outside (0, 1).
 */
export function invNorm(p: number): number {
  if (!(p > 0 && p < 1)) throw new RangeError('invNorm needs 0 < p < 1');
  const a = [
    -3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2,
    1.38357751867269e2, -3.066479806614716e1, 2.506628277459239,
  ];
  const b = [
    -5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2,
    6.680131188771972e1, -1.328068155288572e1,
  ];
  const c = [
    -7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838,
    -2.549732539343734, 4.374664141464968, 2.938163982698783,
  ];
  const d = [
    7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996,
    3.754408661907416,
  ];
  const low = 0.02425;
  let x: number;
  if (p < low) {
    const q = Math.sqrt(-2 * Math.log(p));
    x =
      (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
      ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  } else if (p > 1 - low) {
    const q = Math.sqrt(-2 * Math.log(1 - p));
    x =
      -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
      ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  } else {
    const q = p - 0.5;
    const r = q * q;
    x =
      ((((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) *
        q) /
      (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
  }
  return x;
}

/** Two-sided critical value, e.g. 1.95996 for conf = 0.95. */
export const zForConf = (conf: number) => invNorm(1 - (1 - conf) / 2);

// ── proportions ─────────────────────────────────────────────────────────────

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

export interface Interval {
  /** Observed proportion, null when n = 0. */
  p: number | null;
  lo: number;
  hi: number;
}

/** Wilson score interval. n = 0 gives the uninformative (0, 1). */
export function wilson(x: number, n: number, conf = 0.95): Interval {
  if (n <= 0) return { p: null, lo: 0, hi: 1 };
  const z = zForConf(conf);
  const p = x / n;
  const z2 = z * z;
  const denom = 1 + z2 / n;
  const centre = (p + z2 / (2 * n)) / denom;
  const half = (z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / denom;
  return { p, lo: clamp01(centre - half), hi: clamp01(centre + half) };
}

export interface DiffInterval {
  /** p1 - p2 */
  d: number;
  lo: number;
  hi: number;
}

/**
 * Newcombe hybrid score interval (method 10) for p1 - p2, two independent
 * proportions. lo = d - sqrt((p1-l1)^2 + (u2-p2)^2), hi = d + sqrt((u1-p1)^2 +
 * (p2-l2)^2), with (l, u) the Wilson bounds. Needs n1, n2 > 0.
 */
export function newcombeDiff(
  x1: number,
  n1: number,
  x2: number,
  n2: number,
  conf = 0.95,
): DiffInterval {
  if (n1 <= 0 || n2 <= 0) {
    throw new RangeError('newcombeDiff needs at least one company in each arm');
  }
  const a = wilson(x1, n1, conf);
  const b = wilson(x2, n2, conf);
  const p1 = a.p as number;
  const p2 = b.p as number;
  const d = p1 - p2;
  return {
    d,
    lo: Math.max(-1, d - Math.sqrt((p1 - a.lo) ** 2 + (b.hi - p2) ** 2)),
    hi: Math.min(1, d + Math.sqrt((a.hi - p1) ** 2 + (p2 - b.lo) ** 2)),
  };
}

// ── sample size ─────────────────────────────────────────────────────────────

export interface SampleSizeInput {
  /** Control rate, e.g. 0.03. */
  baseline: number;
  /** The lift we hope to see, as a fraction (0.04 = +4 points). */
  targetLift: number;
  /** The smallest lift worth acting on (0.02 = +2 points). */
  minLift: number;
  alpha?: number;
  power?: number;
  /**
   * 'lower_bound' (our rule): the interval's LOWER bound must clear minLift.
   * 'significance': the classic "is it different from zero" test.
   */
  rule: 'lower_bound' | 'significance';
}

export interface SampleSize {
  /** Companies per arm (rounded up), or Infinity. */
  n: number;
  /** Why n is Infinity; null otherwise. */
  reason: string | null;
}

export function sampleSizePerArm(input: SampleSizeInput): SampleSize {
  const { baseline, targetLift, minLift, rule } = input;
  const alpha = input.alpha ?? 0.05;
  const power = input.power ?? 0.8;
  const za = invNorm(1 - alpha / 2);
  const zb = invNorm(power);
  const p1 = baseline;
  const p2 = baseline + targetLift;
  const v = p1 * (1 - p1) + p2 * (1 - p2);
  if (rule === 'lower_bound') {
    if (targetLift <= minLift) {
      return { n: Infinity, reason: 'target must exceed minimum lift' };
    }
    return {
      n: Math.ceil(((za + zb) ** 2 * v) / (targetLift - minLift) ** 2),
      reason: null,
    };
  }
  if (targetLift === 0) {
    return { n: Infinity, reason: 'target lift must not be zero' };
  }
  const pbar = (p1 + p2) / 2;
  const num = (za * Math.sqrt(2 * pbar * (1 - pbar)) + zb * Math.sqrt(v)) ** 2;
  return { n: Math.ceil(num / targetLift ** 2), reason: null };
}

// ── balance checks ──────────────────────────────────────────────────────────

/** Sample-ratio mismatch: do the arm sizes fit the planned split? (chi-square, 1 df) */
export function srmCheck(
  nA: number,
  nB: number,
  expectedShareA = 0.5,
): { chi2: number; p: number } {
  const total = nA + nB;
  if (total <= 0) return { chi2: 0, p: 1 };
  const eA = total * expectedShareA;
  const eB = total * (1 - expectedShareA);
  const chi2 = (nA - eA) ** 2 / eA + (nB - eB) ** 2 / eB;
  // 1 degree of freedom: P(X > chi2) = 2 * (1 - Phi(sqrt(chi2)))
  return { chi2, p: Math.min(1, 2 * (1 - normCdf(Math.sqrt(chi2)))) };
}

/** Two-proportion z-test (pooled), two-sided. */
export function twoPropTest(
  x1: number,
  n1: number,
  x2: number,
  n2: number,
): { z: number; p: number; diff: number } {
  if (n1 <= 0 || n2 <= 0) return { z: 0, p: 1, diff: 0 };
  const diff = x1 / n1 - x2 / n2;
  const pooled = (x1 + x2) / (n1 + n2);
  const se = Math.sqrt(pooled * (1 - pooled) * (1 / n1 + 1 / n2));
  if (se === 0) return { z: 0, p: 1, diff };
  const z = diff / se;
  return { z, p: Math.min(1, 2 * (1 - normCdf(Math.abs(z)))), diff };
}
