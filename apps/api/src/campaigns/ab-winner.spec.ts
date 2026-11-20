import { adviseWinner, probabilityBest } from './ab-winner';

const v = (index: number, sent: number, replies: number) => ({
  index,
  subject: `S${index}`,
  sent,
  replies,
  opens: 0,
});

describe('A/B winner (replies, Bayesian)', () => {
  it('probabilities sum to 1 and favour the better reply rate', () => {
    const p = probabilityBest([v(0, 100, 2), v(1, 100, 12)]);
    expect(p[0] + p[1]).toBeCloseTo(1, 5);
    expect(p[1]).toBeGreaterThan(0.95);
  });

  it('is deterministic for the same numbers', () => {
    const a = probabilityBest([v(0, 50, 3), v(1, 50, 5)]);
    expect(probabilityBest([v(0, 50, 3), v(1, 50, 5)])).toEqual(a);
  });

  it('says keep testing until every version has enough sends', () => {
    const r = adviseWinner([v(0, 12, 0), v(1, 30, 5)]);
    expect(r.suggestion).toBeNull();
    expect(r.reason).toMatch(/needs 20 sends.*A has 12/);
  });

  it('waits for replies, not opens', () => {
    const r = adviseWinner([v(0, 40, 0), v(1, 40, 0)]);
    expect(r.suggestion).toBeNull();
    expect(r.reason).toMatch(/no replies yet/);
  });

  it('does not call a close race', () => {
    const r = adviseWinner([v(0, 40, 4), v(1, 40, 5)]);
    expect(r.suggestion).toBeNull();
    expect(r.reason).toMatch(/No clear winner/);
  });

  it('suggests a clear winner with its probability', () => {
    const r = adviseWinner([v(0, 60, 1), v(1, 60, 9), v(2, 60, 2)]);
    expect(r.suggestion?.index).toBe(1);
    expect(r.suggestion!.probBest).toBeGreaterThanOrEqual(0.9);
    expect(r.reason).toMatch(/Version B/);
  });
});
