import { arm, armB, input } from './__fixtures__/inputs';
import { decide } from './decide';
import { explain } from './explain-template';

describe('explain (deterministic, no AI)', () => {
  it('9 of 210 vs 4 of 205: says it in plain words and refuses to call a winner', () => {
    const r = decide(
      input({
        targetNPerArm: null,
        arms: [
          arm({
            assigned: 205,
            sent: 205,
            delivered: 201,
            bounced: 4,
            windowClosed: 205,
            qualifiedVerified: 4,
          }),
          armB({
            assigned: 210,
            sent: 210,
            delivered: 206,
            bounced: 4,
            windowClosed: 210,
            qualifiedVerified: 9,
          }),
        ],
      }),
    );
    expect(r.decision).toBe('inconclusive');
    const e = explain(r);
    const text = e.points.map((p) => p.text).join(' ');
    expect(text).toContain(
      'Version B got confirmed qualified replies from 9 of 210 companies (4.3%)',
    );
    expect(text).toContain(
      'version A got confirmed qualified replies from 4 of 205 companies (2.0%)',
    );
    expect(text).toContain(
      "The difference is +2.3 points, but it could be anywhere from −1.2 to +6.2 points, so we can't call a winner yet.",
    );
    expect(e.summary).toBe(r.recommendation);
  });

  it('every point cites findings that exist', () => {
    const r = decide(input({ outcomeCoverage: 0.5 }));
    const ids = new Set(r.findings.map((f) => f.id));
    for (const p of explain(r).points) {
      expect(p.findingIds.length).toBeGreaterThan(0);
      for (const id of p.findingIds) expect(ids.has(id)).toBe(true);
    }
  });

  it('a clear win states the likely range without the "can\'t call a winner" line', () => {
    const e = explain(decide(input()));
    const lift = e.points.find((p) => p.text.startsWith('The difference is'))!;
    expect(lift.text).not.toContain("can't call a winner");
    expect(lift.text).toMatch(
      /^The difference is \+4\.0 points, and the likely range is \+2\.\d to \+\d\.\d points\.$/,
    );
  });

  it('includes failed-gate reasons, the sample plan and the opens diagnostic', () => {
    const gated = explain(decide(input({ outcomeCoverage: 0.5 })));
    expect(gated.points.some((p) => p.text.includes('Confirm or reject'))).toBe(
      true,
    );
    const guard = explain(
      decide(input({ arms: [arm(), armB({ bounced: 70 })] })),
    );
    expect(guard.points.some((p) => p.text.includes('bounces 7.0%'))).toBe(
      true,
    );
    const plan = explain(
      decide(
        input({
          arms: [
            arm({ qualifiedVerified: 25 }),
            armB({ qualifiedVerified: 55 }),
          ],
        }),
      ),
    );
    expect(plan.points.some((p) => p.text.includes('would settle it'))).toBe(
      true,
    );
    expect(plan.points.at(-1)!.text).toContain('opens are unreliable');
  });

  it('a negative lift uses a real minus sign, and no data reads "no data"', () => {
    const worse = explain(
      decide(
        input({
          arms: [
            arm({ qualifiedVerified: 60 }),
            armB({ qualifiedVerified: 20 }),
          ],
        }),
      ),
    );
    expect(worse.points.some((p) => p.text.includes('−4.0 points'))).toBe(true);
    const empty = explain(
      decide(
        input({
          arms: [
            arm({
              assigned: 0,
              sent: 0,
              delivered: 0,
              bounced: 0,
              qualifiedVerified: 0,
              windowClosed: 0,
            }),
            armB({
              assigned: 0,
              sent: 0,
              delivered: 0,
              bounced: 0,
              qualifiedVerified: 0,
              windowClosed: 0,
            }),
          ],
        }),
      ),
    );
    expect(empty.points.some((p) => p.text.includes('no data'))).toBe(true);
    expect(empty.points.some((p) => p.text.startsWith('The difference'))).toBe(
      false,
    );
  });
});
