import { decide, explain } from './policy';
import { SCENARIOS, simulate, type ScenarioId } from './simulation';

const run = (s: ScenarioId) => {
  const sim = simulate(s);
  return { sim, result: decide(sim.input) };
};

describe('Try simulation scenarios (same policy as real results)', () => {
  it('valid_winner -> promote B', () => {
    const { result } = run('valid_winner');
    expect(result.decision).toBe('promote');
    expect(result.winnerVariantId).toBe('sim-b');
    expect(result.failedGates).toEqual([]);
  });

  it('inconclusive_small -> inconclusive, and a longer test is worth it', () => {
    const { result } = run('inconclusive_small');
    expect(result.decision).toBe('inconclusive');
    expect(result.sampleNeededPerArm).not.toBeNull();
    expect(result.recommendation).toContain('would settle it');
  });

  it('high_open_low_conv -> never B (control wins), though B has twice the opens', () => {
    const { result } = run('high_open_low_conv');
    expect(result.decision).toBe('promote');
    expect(result.winnerVariantId).toBe('sim-a');
    expect(result.arms[1].openRate!).toBeGreaterThan(
      result.arms[0].openRate! * 1.8,
    );
  });

  it('delivery_imbalance -> keep collecting (delivery_balance), no guardrail breach', () => {
    const { result } = run('delivery_imbalance');
    expect(result.decision).toBe('keep_collecting');
    expect(result.failedGates).toEqual(['delivery_balance']);
  });

  it('misleading_city -> inconclusive overall, but the city slice looks strong', () => {
    const { sim, result } = run('misleading_city');
    expect(result.decision).toBe('inconclusive');
    const city = sim.slices.find((s) => s.factor === 'city')!;
    const rate = (value: string) => {
      const b = city.buckets.find((x) => x.value === value)!;
      return (
        b.arms.reduce((n, a) => n + a.qualified, 0) /
        b.arms.reduce((n, a) => n + a.assigned, 0)
      );
    };
    // Pune looks about twice as good as the rest...
    expect(rate('Pune')).toBeGreaterThan(rate('Delhi') * 1.8);
    // ...but within the hiring trigger every city is about the same
    expect(sim.note).toContain('Treat slices as hints');
  });

  it('is repeatable: the same scenario gives identical numbers every time', () => {
    for (const s of SCENARIOS) {
      expect(JSON.stringify(simulate(s.id))).toBe(
        JSON.stringify(simulate(s.id)),
      );
    }
  });

  it('every scenario is marked simulated and explains itself in plain words', () => {
    for (const s of SCENARIOS) {
      const { sim, result } = run(s.id);
      expect(sim.input.simulated).toBe(true);
      expect(result.simulated).toBe(true);
      expect(explain(result).points.length).toBeGreaterThan(2);
    }
  });
});
