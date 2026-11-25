import {
  invNorm,
  newcombeDiff,
  normCdf,
  sampleSizePerArm,
  srmCheck,
  twoPropTest,
  wilson,
  zForConf,
} from './stats';

/**
 * Reference values:
 *  - Newcombe (1998), Statistics in Medicine 17:873-890, Table II: 56/70 vs
 *    48/80 -> difference 0.2000, method 10 interval (0.0524, 0.3339).
 *  - Every other value was computed with an INDEPENDENT pure-Python
 *    re-implementation of the same textbook formulas (statistics.NormalDist),
 *    kept in the T04 session scratch. statsmodels was not installed on the
 *    build machine, so these are NOT statsmodels output.
 */
const near = (a: number, b: number, digits = 4) =>
  expect(a).toBeCloseTo(b, digits);

describe('normal distribution helpers', () => {
  it('z for 95% is 1.95996, z at power 0.8 is 0.84162, z for 99% is 2.57583', () => {
    near(zForConf(0.95), 1.959964, 4);
    near(invNorm(0.8), 0.841621, 4);
    near(zForConf(0.99), 2.575829, 4);
    near(invNorm(0.975), 1.95996, 4);
  });

  it('inverse handles the tails and the middle, and rejects 0 and 1', () => {
    near(invNorm(0.5), 0, 6);
    near(invNorm(0.001), -3.090232, 4); // low tail branch
    near(invNorm(0.999), 3.090232, 4); // high tail branch
    expect(() => invNorm(0)).toThrow(RangeError);
    expect(() => invNorm(1)).toThrow(RangeError);
  });

  it('CDF is symmetric and matches known points', () => {
    near(normCdf(0), 0.5, 6);
    near(normCdf(1.959964), 0.975, 5);
    near(normCdf(-1.959964), 0.025, 5);
    near(normCdf(-3), 0.0013499, 5);
  });
});

describe('wilson', () => {
  it('9 of 210 -> 4.29% (2.27%, 7.94%)', () => {
    const w = wilson(9, 210);
    near(w.p as number, 0.042857);
    near(w.lo, 0.022709);
    near(w.hi, 0.07943);
  });

  it('56 of 70 -> (0.6918, 0.8770); 1 of 100 -> (0.0018, 0.0545)', () => {
    near(wilson(56, 70).lo, 0.691834);
    near(wilson(56, 70).hi, 0.876953);
    near(wilson(1, 100).lo, 0.001767);
    near(wilson(1, 100).hi, 0.054486);
  });

  it('the edges stay inside 0..1 (0 of 20, 20 of 20)', () => {
    const z = wilson(0, 20);
    expect(z.p).toBe(0);
    expect(z.lo).toBe(0);
    near(z.hi, 0.161125);
    const f = wilson(20, 20);
    near(f.lo, 0.838875);
    expect(f.hi).toBe(1);
  });

  it('a 90% interval is narrower than a 95% one', () => {
    const w90 = wilson(9, 210, 0.9);
    near(w90.lo, 0.025101);
    near(w90.hi, 0.072243);
  });

  it('n = 0 is uninformative: p null, (0, 1)', () => {
    expect(wilson(0, 0)).toEqual({ p: null, lo: 0, hi: 1 });
  });
});

describe('newcombeDiff (hybrid score, method 10)', () => {
  it('Newcombe 1998: 56/70 vs 48/80 -> d = 0.2000, CI (0.0524, 0.3339)', () => {
    const r = newcombeDiff(56, 70, 48, 80);
    near(r.d, 0.2);
    near(r.lo, 0.0524);
    near(r.hi, 0.3339);
  });

  it('9/210 vs 4/205 -> +2.3 points, CI (-1.24, +6.18)', () => {
    const r = newcombeDiff(9, 210, 4, 205);
    near(r.d, 0.023345);
    near(r.lo, -0.012441);
    near(r.hi, 0.061805);
  });

  it('30/400 vs 12/400 -> CI (0.0141, 0.0776)', () => {
    const r = newcombeDiff(30, 400, 12, 400);
    near(r.d, 0.045);
    near(r.lo, 0.014127);
    near(r.hi, 0.077644);
  });

  it('0/50 vs 5/60 -> CI (-0.1807, 0.0022); 15/16 vs 4/16 -> (0.3577, 0.8443)', () => {
    const a = newcombeDiff(0, 50, 5, 60);
    near(a.d, -0.083333);
    near(a.lo, -0.180689);
    near(a.hi, 0.002221);
    const b = newcombeDiff(15, 16, 4, 16);
    near(b.d, 0.6875);
    near(b.lo, 0.357706);
    near(b.hi, 0.844335);
  });

  it('is antisymmetric: swapping the arms mirrors the interval', () => {
    const r = newcombeDiff(9, 210, 4, 205);
    const s = newcombeDiff(4, 205, 9, 210);
    near(s.d, -r.d, 10);
    near(s.lo, -r.hi, 10);
    near(s.hi, -r.lo, 10);
  });

  it('stays within -1..1 and needs data in both arms', () => {
    const r = newcombeDiff(20, 20, 0, 20);
    expect(r.hi).toBeLessThanOrEqual(1);
    const r2 = newcombeDiff(0, 20, 20, 20);
    expect(r2.lo).toBeGreaterThanOrEqual(-1);
    expect(() => newcombeDiff(1, 0, 1, 10)).toThrow(RangeError);
    expect(() => newcombeDiff(1, 10, 1, 0)).toThrow(RangeError);
  });
});

describe('sampleSizePerArm', () => {
  it('lower-bound rule: baseline 3%, target +4 pp, min +2 pp needs 1849 companies per arm', () => {
    const r = sampleSizePerArm({
      baseline: 0.03,
      targetLift: 0.04,
      minLift: 0.02,
      rule: 'lower_bound',
    });
    expect(r.reason).toBeNull();
    // printed so it is visible in the test output: ~1,849 per arm
    expect(r.n).toBe(1849);
  });

  it('lower-bound rule: baseline 5%, target +5 pp, min +2 pp -> 1200', () => {
    expect(
      sampleSizePerArm({
        baseline: 0.05,
        targetLift: 0.05,
        minLift: 0.02,
        rule: 'lower_bound',
      }).n,
    ).toBe(1200);
  });

  it('lower-bound rule: a target at or below the minimum is Infinity, with a reason', () => {
    for (const targetLift of [0.02, 0.01]) {
      const r = sampleSizePerArm({
        baseline: 0.03,
        targetLift,
        minLift: 0.02,
        rule: 'lower_bound',
      });
      expect(r.n).toBe(Infinity);
      expect(r.reason).toBe('target must exceed minimum lift');
    }
  });

  it('significance rule (classic two-proportion formula)', () => {
    expect(
      sampleSizePerArm({
        baseline: 0.03,
        targetLift: 0.04,
        minLift: 0.02,
        rule: 'significance',
      }).n,
    ).toBe(465);
    expect(
      sampleSizePerArm({
        baseline: 0.1,
        targetLift: 0.05,
        minLift: 0,
        rule: 'significance',
      }).n,
    ).toBe(686);
    const zero = sampleSizePerArm({
      baseline: 0.1,
      targetLift: 0,
      minLift: 0,
      rule: 'significance',
    });
    expect(zero.n).toBe(Infinity);
    expect(zero.reason).toBe('target lift must not be zero');
  });

  it('alpha and power can be changed (stricter -> more companies)', () => {
    const base = {
      baseline: 0.03,
      targetLift: 0.04,
      minLift: 0.02,
      rule: 'lower_bound' as const,
    };
    expect(sampleSizePerArm({ ...base, power: 0.9 }).n).toBeGreaterThan(1849);
    expect(sampleSizePerArm({ ...base, alpha: 0.01 }).n).toBeGreaterThan(1849);
  });
});

describe('srmCheck (sample-ratio mismatch)', () => {
  it('500/500 is perfect; 520/480 is fine; 560/440 is a mismatch (p = 0.000148)', () => {
    expect(srmCheck(500, 500)).toEqual({ chi2: 0, p: 1 });
    const ok = srmCheck(520, 480);
    near(ok.chi2, 1.6);
    near(ok.p, 0.205903, 4);
    const bad = srmCheck(560, 440);
    near(bad.chi2, 14.4);
    near(bad.p, 0.000148, 5);
  });

  it('honours a different planned split (60/40 planned, 60/40 seen)', () => {
    expect(srmCheck(60, 40, 0.6).p).toBe(1);
  });

  it('no companies yet -> nothing to flag', () => {
    expect(srmCheck(0, 0)).toEqual({ chi2: 0, p: 1 });
  });
});

describe('twoPropTest', () => {
  it('180/200 vs 150/200 -> z = 3.9477, p = 0.000079', () => {
    const r = twoPropTest(180, 200, 150, 200);
    near(r.z, 3.94771, 4);
    near(r.p, 0.000079, 5);
    near(r.diff, 0.15);
  });

  it('identical rates give p = 1', () => {
    expect(twoPropTest(10, 100, 10, 100).p).toBe(1);
  });

  it('empty arms and all-or-nothing rates do not divide by zero', () => {
    expect(twoPropTest(0, 0, 1, 10)).toEqual({ z: 0, p: 1, diff: 0 });
    expect(twoPropTest(1, 10, 0, 0)).toEqual({ z: 0, p: 1, diff: 0 });
    expect(twoPropTest(0, 10, 0, 10).p).toBe(1);
    expect(twoPropTest(10, 10, 10, 10).p).toBe(1);
  });
});
