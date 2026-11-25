import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { arm, armB, input } from './__fixtures__/inputs';
import { decide, DIAGNOSTIC_NOTE } from './decide';
import { sampleSizePerArm } from './stats';
import { POLICY_VERSION } from './types';

describe('decide: the named fixtures from the spec', () => {
  it('valid winner -> promote the challenger, propose pausing the control', () => {
    const r = decide(input());
    expect(r.decision).toBe('promote');
    expect(r.winnerVariantId).toBe('v-b');
    expect(r.lift!.lo).toBeGreaterThanOrEqual(0.02);
    expect(r.failedGates).toEqual([]);
    expect(r.allowedActions.map((a) => a.type)).toEqual([
      'pause_variant',
      'draft_challenger',
    ]);
    expect(r.allowedActions[0].variantId).toBe('v-a');
    expect(r.recommendation).toContain('Keep B');
  });

  it('small sample -> keep collecting (minimum_sample)', () => {
    const r = decide(
      input({
        arms: [
          arm({
            assigned: 50,
            sent: 50,
            delivered: 49,
            windowClosed: 50,
            qualifiedVerified: 1,
            bounced: 1,
            unsubscribed: 0,
          }),
          armB({
            assigned: 50,
            sent: 50,
            delivered: 49,
            windowClosed: 50,
            qualifiedVerified: 4,
            bounced: 1,
            unsubscribed: 0,
          }),
        ],
      }),
    );
    expect(r.decision).toBe('keep_collecting');
    expect(r.failedGates).toEqual(['minimum_sample']);
    expect(r.winnerVariantId).toBeNull();
    expect(r.allowedActions.map((a) => a.type)).toEqual(['keep_testing']);
  });

  it('high opens, low conversion: B has 60% opens but 1% qualified, A 30% opens and 4% -> never B', () => {
    const r = decide(
      input({
        arms: [
          arm({ opened: 294, qualifiedVerified: 40 }),
          armB({ opened: 588, qualifiedVerified: 10 }),
        ],
      }),
    );
    expect(['promote', 'inconclusive']).toContain(r.decision);
    expect(r.winnerVariantId).not.toBe('v-b');
    expect(r.lift!.d).toBeLessThan(0);
    // opens are only a labelled diagnostic
    expect(r.arms[1].openRate).toBeCloseTo(0.6, 5);
    expect(r.diagnosticNote).toBe(DIAGNOSTIC_NOTE);
    expect(r.findings.some((f) => f.kind === 'diagnostic')).toBe(true);
  });

  it('opens alone cannot make a winner: huge open gap, identical conversion -> inconclusive', () => {
    const r = decide(
      input({
        arms: [
          arm({ opened: 200, qualifiedVerified: 30 }),
          armB({ opened: 900, qualifiedVerified: 30 }),
        ],
      }),
    );
    expect(r.decision).toBe('inconclusive');
    expect(r.winnerVariantId).toBeNull();
  });

  it('delivery imbalance -> keep collecting (delivery_balance)', () => {
    const r = decide(input({ arms: [arm(), armB({ delivered: 800 })] }));
    expect(r.decision).toBe('keep_collecting');
    expect(r.failedGates).toEqual(['delivery_balance']);
  });

  it('assignment imbalance (sample-ratio mismatch) -> keep collecting (assignment_balance)', () => {
    const r = decide(
      input({
        arms: [
          arm({
            assigned: 560,
            sent: 560,
            delivered: 549,
            bounced: 11,
            windowClosed: 560,
          }),
          armB({
            assigned: 440,
            sent: 440,
            delivered: 431,
            bounced: 9,
            windowClosed: 440,
          }),
        ],
        targetNPerArm: 400,
      }),
    );
    expect(r.decision).toBe('keep_collecting');
    expect(r.failedGates).toEqual(['assignment_balance']);
  });

  it('guardrail breach (bounce 7%) -> guardrail_breach, no winner, not called a loss', () => {
    const r = decide(input({ arms: [arm(), armB({ bounced: 70 })] }));
    expect(r.decision).toBe('guardrail_breach');
    expect(r.winnerVariantId).toBeNull();
    expect(r.failedGates).toEqual(['guardrails']);
    expect(r.warnings).toContain('guardrail_breach');
    expect(r.recommendation).toContain('deliverability');
    expect(r.recommendation).not.toMatch(/lost|loss|loser/i);
  });

  it('a guardrail breach wins over other unfinished gates (it is urgent), and all failed gates are listed', () => {
    const r = decide(
      input({
        outcomeCoverage: 0.5,
        arms: [arm(), armB({ bounced: 70 })],
      }),
    );
    expect(r.decision).toBe('guardrail_breach');
    expect(r.failedGates).toEqual(['outcome_coverage', 'guardrails']);
  });

  it('immature window -> keep collecting, with the earliest full read date', () => {
    const r = decide(
      input({
        arms: [arm({ windowClosed: 700 }), armB({ windowClosed: 700 })],
        earliestFullRead: new Date('2027-01-05T00:00:00Z'),
      }),
    );
    expect(r.decision).toBe('keep_collecting');
    expect(r.failedGates).toEqual(['window_mature']);
    expect(r.recommendation).toContain('Earliest full read: 2027-01-05');
    expect(r.gates[0].nextCheck).toBe('2027-01-05');
  });

  it('low coverage (80%) -> keep collecting with the "confirm N replies" message, and mentions extra failed checks', () => {
    const r = decide(
      input({
        outcomeCoverage: 0.8,
        arms: [
          arm({ qualifiedProvisional: 4 }),
          armB({ qualifiedProvisional: 3 }),
        ],
      }),
    );
    expect(r.decision).toBe('keep_collecting');
    expect(r.recommendation).toContain('Confirm or reject 7 more replies');
    const two = decide(
      input({
        outcomeCoverage: 0.8,
        flags: {
          unattributedReplies: 0,
          ambiguousAttribution: 2,
          variantEditedWhileRunning: false,
        },
      }),
    );
    expect(two.recommendation).toContain('(and 1 more checks)');
  });

  it('challenger clearly worse -> keep the control, propose pausing the challenger', () => {
    const r = decide(
      input({
        arms: [arm({ qualifiedVerified: 60 }), armB({ qualifiedVerified: 20 })],
      }),
    );
    expect(r.decision).toBe('promote');
    expect(r.winnerVariantId).toBe('v-a');
    const pause = r.allowedActions.find((a) => a.type === 'pause_variant');
    expect(pause?.variantId).toBe('v-b');
    expect(r.recommendation).toContain('Keep A and pause B');
  });

  it('inconclusive and worth continuing -> says how many companies would settle it', () => {
    const big = (over = {}) => ({
      assigned: 3000,
      sent: 3000,
      delivered: 2940,
      bounced: 60,
      windowClosed: 3000,
      ...over,
    });
    const r = decide(
      input({
        arms: [
          arm(big({ qualifiedVerified: 90 })),
          armB(big({ qualifiedVerified: 180 })),
        ],
        targetNPerArm: 2000,
      }),
    );
    expect(r.decision).toBe('inconclusive');
    expect(r.sampleNeededPerArm).toBe(6711);
    expect(r.recommendation).toContain('About 6711 companies per version');
    expect(r.allowedActions.map((a) => a.type)).toEqual(['keep_testing']);
    expect(r.findings.find((f) => f.kind === 'sample_plan')).toMatchObject({
      neededPerArm: 6711,
      havePerArm: 3000,
    });
  });

  it('inconclusive and NOT worth continuing -> keep control, try a new challenger', () => {
    const r = decide(
      input({
        arms: [
          armB({
            isControl: true,
            variantId: 'v-a',
            label: 'A',
            qualifiedVerified: 25,
          }),
          armB({ qualifiedVerified: 38 }),
        ],
      }),
    );
    expect(r.decision).toBe('inconclusive');
    expect(r.sampleNeededPerArm).toBeNull(); // lift is below the minimum worth acting on
    expect(r.recommendation).toContain('not worth it at this volume');
    expect(r.allowedActions.map((a) => a.type)).toEqual([
      'keep_testing',
      'draft_challenger',
    ]);
  });

  it('inconclusive when the lift clears the minimum but the sample needed is more than 3x what we have', () => {
    const r = decide(
      input({
        arms: [arm({ qualifiedVerified: 25 }), armB({ qualifiedVerified: 55 })],
      }),
    );
    expect(r.decision).toBe('inconclusive');
    expect(r.sampleNeededPerArm).toBe(6711);
    expect(r.recommendation).toContain('not worth it at this volume');
  });
});

// The sample-size table row, with the number in the test NAME so it shows in
// the test output: baseline 3%, target +4 pp, minimum +2 pp, lower-bound rule.
const tableN = sampleSizePerArm({
  baseline: 0.03,
  targetLift: 0.04,
  minLift: 0.02,
  rule: 'lower_bound',
}).n;
describe('sample-size table', () => {
  it(`baseline 3%, target +4 pp, min +2 pp (lower-bound rule) needs n = ${tableN} companies per arm`, () => {
    expect(tableN).toBe(1849);
  });
});

describe('decide: other behaviour', () => {
  it('no sample plan is a warning, not a block', () => {
    const r = decide(input({ targetNPerArm: null }));
    expect(r.decision).toBe('promote');
    expect(r.warnings).toEqual(['no sample plan']);
  });

  it('with no arm flagged as control, the first arm is the control', () => {
    const r = decide(
      input({ arms: [arm({ isControl: false }), armB({ isControl: false })] }),
    );
    expect(r.lift!.controlId).toBe('v-a');
    expect(r.lift!.challengerId).toBe('v-b');
  });

  it('puts the control first even when it is listed second', () => {
    const r = decide(input({ arms: [armB(), arm()] }));
    expect(r.arms.map((a) => a.variantId)).toEqual(['v-a', 'v-b']);
    expect(r.decision).toBe('promote');
  });

  it('an empty review (no companies yet) keeps collecting with no lift and no crash', () => {
    const r = decide(
      input({
        arms: [
          arm({
            assigned: 0,
            sent: 0,
            delivered: 0,
            bounced: 0,
            qualifiedVerified: 0,
            windowClosed: 0,
            opened: 0,
            replied: 0,
          }),
          armB({
            assigned: 0,
            sent: 0,
            delivered: 0,
            bounced: 0,
            qualifiedVerified: 0,
            windowClosed: 0,
            opened: 0,
            replied: 0,
          }),
        ],
      }),
    );
    expect(r.decision).toBe('keep_collecting');
    expect(r.lift).toBeNull();
    expect(r.arms[0].qualifiedRate).toBeNull();
    expect(r.recommendation).toContain('has no companies yet');
  });

  it('keeps collecting with a default message when only a lift is missing', () => {
    // an arm with companies but nothing delivered: rates are null, still no crash
    const r = decide(
      input({
        arms: [
          arm({ sent: 0, delivered: 0, bounced: 0 }),
          armB({ sent: 0, delivered: 0, bounced: 0 }),
        ],
      }),
    );
    expect(r.arms[0].qualifiedRateOfDelivered).toBeNull();
    expect(r.arms[0].openRate).toBeNull();
  });

  it('refuses anything but exactly two versions', () => {
    expect(() => decide(input({ arms: [arm()] }))).toThrow(
      'A review compares exactly 2 versions',
    );
    expect(() => decide(input({ arms: [arm(), armB(), armB()] }))).toThrow();
  });

  it('simulated is carried through unchanged, and the policy version is the one given', () => {
    const r = decide(input({ simulated: true }));
    expect(r.simulated).toBe(true);
    expect(r.policyVersion).toBe(POLICY_VERSION);
    expect(POLICY_VERSION).toBe('review-policy/1');
  });

  it('action ids are stable, differ by type, target and review, and are short hex', () => {
    const a = decide(input());
    const b = decide(input());
    expect(a.allowedActions.map((x) => x.actionId)).toEqual(
      b.allowedActions.map((x) => x.actionId),
    );
    const ids = a.allowedActions.map((x) => x.actionId);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids[0]).toMatch(/^[0-9a-f]{16}$/);
    const other = decide(input({ reviewId: 'review-9' }));
    expect(other.allowedActions[0].actionId).not.toBe(ids[0]);
  });

  it('findings have stable ids F1..Fn in a fixed order', () => {
    const r = decide(input());
    expect(r.findings.map((f) => f.id)).toEqual(['F1', 'F2', 'F3', 'F4']);
    expect(r.findings.map((f) => f.kind)).toEqual([
      'rate',
      'rate',
      'lift',
      'diagnostic',
    ]);
    const gated = decide(input({ outcomeCoverage: 0.5 }));
    expect(gated.findings.some((f) => f.kind === 'gate')).toBe(true);
  });

  it('is deterministic: the same input gives the same output (snapshot)', () => {
    const a = decide(input());
    expect(JSON.stringify(decide(input()))).toBe(JSON.stringify(a));
    expect(a).toMatchSnapshot();
  });
});

describe('policy folder is pure', () => {
  const dir = __dirname;
  const files = readdirSync(dir).filter(
    (f) => f.endsWith('.ts') && !f.endsWith('.spec.ts'),
  );

  it.each(files)('%s imports only siblings and node:crypto', (f) => {
    const src = readFileSync(join(dir, f), 'utf8');
    const from = [...src.matchAll(/from\s+['"]([^'"]+)['"]/g)].map((m) => m[1]);
    for (const spec of from) {
      expect(spec === 'crypto' || spec.startsWith('./')).toBe(true);
    }
    expect(src).not.toMatch(/@nestjs|from ['"]pg['"]|\.\.\/(db|ai)\//);
  });
});
