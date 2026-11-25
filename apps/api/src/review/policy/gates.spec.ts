import { arm, armB, input } from './__fixtures__/inputs';
import {
  assignmentBalanceGate,
  attributionCleanGate,
  copyFrozenGate,
  deliveryBalanceGate,
  guardrailsGate,
  minimumSampleGate,
  outcomeCoverageGate,
  runGates,
  windowMatureGate,
} from './gates';

describe('gate 1: window_mature', () => {
  it('passes when every window is closed and the decision date is reached', () => {
    expect(windowMatureGate(input())).toMatchObject({
      id: 'window_mature',
      passed: true,
      nextCheck: null,
    });
  });

  it('fails with the count and the earliest full read date', () => {
    const g = windowMatureGate(
      input({
        arms: [arm({ windowClosed: 600 }), armB({ windowClosed: 800 })],
        earliestFullRead: new Date('2027-01-05T00:00:00Z'),
      }),
    );
    expect(g.passed).toBe(false);
    expect(g.reason).toBe(
      '600 of 2000 companies are still inside their reply window. Earliest full read: 2027-01-05.',
    );
    expect(g.nextCheck).toBe('2027-01-05');
  });

  it('fails before the decision date even if every window is closed', () => {
    const g = windowMatureGate(
      input({ decisionDate: new Date('2027-02-01T00:00:00Z') }),
    );
    expect(g.passed).toBe(false);
    expect(g.reason).toContain(
      'The decision date (2027-02-01) has not been reached.',
    );
    // the later of the two known dates
    expect(g.nextCheck).toBe('2027-02-01');
  });

  it('with no decision date, only the windows matter', () => {
    expect(windowMatureGate(input({ decisionDate: null })).passed).toBe(true);
  });

  it('with no dates at all there is no next check to give', () => {
    const g = windowMatureGate(
      input({
        decisionDate: null,
        earliestFullRead: null,
        arms: [arm({ windowClosed: 0 }), armB({ windowClosed: 0 })],
      }),
    );
    expect(g.passed).toBe(false);
    expect(g.nextCheck).toBeNull();
    expect(g.reason).toBe(
      '2000 of 2000 companies are still inside their reply window.',
    );
  });
});

describe('gate 2: outcome_coverage', () => {
  it('passes at or above the gate', () => {
    expect(outcomeCoverageGate(input({ outcomeCoverage: 0.9 })).passed).toBe(
      true,
    );
  });

  it('fails below the gate and says how many replies to confirm', () => {
    const g = outcomeCoverageGate(
      input({
        outcomeCoverage: 0.8,
        arms: [
          arm({ qualifiedProvisional: 4 }),
          armB({ qualifiedProvisional: 3 }),
        ],
      }),
    );
    expect(g.passed).toBe(false);
    expect(g.reason).toContain('Confirm or reject 7 more replies.');
  });

  it('says "1 more reply" and never asks for zero', () => {
    const g = outcomeCoverageGate(input({ outcomeCoverage: 0.5 }));
    expect(g.reason).toContain('Confirm or reject 1 more reply.');
  });
});

describe('gate 3: assignment_balance (sample-ratio mismatch)', () => {
  it('passes for an even split', () => {
    expect(assignmentBalanceGate(input()).passed).toBe(true);
  });

  it('fails when the split is far from planned (560 / 440)', () => {
    const g = assignmentBalanceGate(
      input({ arms: [arm({ assigned: 560 }), armB({ assigned: 440 })] }),
    );
    expect(g.passed).toBe(false);
    expect(g.reason).toContain('560 / 440');
  });

  it('respects a different planned split', () => {
    const g = assignmentBalanceGate(
      input({
        expectedShareControl: 0.7,
        arms: [arm({ assigned: 700 }), armB({ assigned: 300 })],
      }),
    );
    expect(g.passed).toBe(true);
  });
});

describe('gate 4: delivery_balance', () => {
  it('passes for similar delivery', () => {
    expect(deliveryBalanceGate(input()).passed).toBe(true);
  });

  it('a significant gap bigger than 5 points fails', () => {
    const g = deliveryBalanceGate(
      input({ arms: [arm(), armB({ delivered: 800 })] }),
    );
    expect(g.passed).toBe(false);
    expect(g.reason).toContain('A 98.0%');
    expect(g.reason).toContain('B 80.0%');
  });

  it('a significant but small gap (under 5 points) still passes', () => {
    const g = deliveryBalanceGate(
      input({
        arms: [
          arm({
            sent: 20000,
            delivered: 19600,
            assigned: 20000,
            windowClosed: 20000,
          }),
          armB({
            sent: 20000,
            delivered: 19300,
            assigned: 20000,
            windowClosed: 20000,
          }),
        ],
      }),
    );
    expect(g.passed).toBe(true);
  });

  it('a big gap that is just noise (tiny samples) passes', () => {
    const g = deliveryBalanceGate(
      input({
        arms: [
          arm({ sent: 10, delivered: 10 }),
          armB({ sent: 10, delivered: 8 }),
        ],
      }),
    );
    expect(g.passed).toBe(true);
  });
});

describe('gate 5: attribution_clean', () => {
  it('passes, and mentions unattributed replies without blocking', () => {
    const g = attributionCleanGate(
      input({
        flags: {
          unattributedReplies: 3,
          ambiguousAttribution: 0,
          variantEditedWhileRunning: false,
        },
      }),
    );
    expect(g.passed).toBe(true);
    expect(g.reason).toContain('3 replies could not be tied to a test');
  });

  it('passes quietly with nothing unattributed', () => {
    expect(attributionCleanGate(input()).reason).toBe(
      'Every reply is tied to one test.',
    );
  });

  it('says "1 reply" for the singular and fails on ambiguity', () => {
    const g = attributionCleanGate(
      input({
        flags: {
          unattributedReplies: 1,
          ambiguousAttribution: 1,
          variantEditedWhileRunning: false,
        },
      }),
    );
    expect(g.passed).toBe(false);
    expect(g.reason).toContain('1 reply could belong to more than one test');
    const one = attributionCleanGate(
      input({
        flags: {
          unattributedReplies: 1,
          ambiguousAttribution: 0,
          variantEditedWhileRunning: false,
        },
      }),
    );
    expect(one.reason).toContain('1 reply could not be tied');
  });
});

describe('gate 6: copy_frozen', () => {
  it('passes when nothing changed', () => {
    expect(copyFrozenGate(input()).passed).toBe(true);
  });
  it('fails when something was edited while running', () => {
    const g = copyFrozenGate(
      input({
        flags: {
          unattributedReplies: 0,
          ambiguousAttribution: 0,
          variantEditedWhileRunning: true,
        },
      }),
    );
    expect(g.passed).toBe(false);
    expect(g.reason).toContain('Start a new test');
  });
});

describe('gate 7: guardrails', () => {
  it('passes inside the limits', () => {
    expect(guardrailsGate(input()).passed).toBe(true);
  });

  it('bounce at the limit is a breach (strictly under is required)', () => {
    const g = guardrailsGate(input({ arms: [arm(), armB({ bounced: 50 })] }));
    expect(g.passed).toBe(false);
    expect(g.warning).toBe('guardrail_breach');
  });

  it('names the arm and metric for bounce 7%, unsubscribes and complaints', () => {
    const g = guardrailsGate(
      input({
        arms: [arm({ unsubscribed: 30 }), armB({ bounced: 70, complaints: 5 })],
      }),
    );
    expect(g.reason).toContain('A: unsubscribes 3.1% (limit 2.0%)');
    expect(g.reason).toContain('B: bounces 7.0% (limit 5.0%)');
    expect(g.reason).toContain('B: complaints 0.51% (limit 0.30%)');
  });

  it('an arm with nothing sent has no rates to breach', () => {
    const g = guardrailsGate(
      input({
        arms: [
          arm({ sent: 0, delivered: 0, bounced: 0, unsubscribed: 0 }),
          armB(),
        ],
      }),
    );
    expect(g.passed).toBe(true);
  });
});

describe('gate 8: minimum_sample', () => {
  it('passes when both arms reach the plan', () => {
    expect(minimumSampleGate(input()).passed).toBe(true);
  });

  it('fails and says which version is short', () => {
    const g = minimumSampleGate(
      input({ arms: [arm({ assigned: 500 }), armB({ assigned: 900 })] }),
    );
    expect(g.passed).toBe(false);
    expect(g.reason).toBe('Planned 800 companies per version; A has 500.');
  });

  it('with no plan it passes with a warning', () => {
    const g = minimumSampleGate(input({ targetNPerArm: null }));
    expect(g.passed).toBe(true);
    expect(g.warning).toBe('no sample plan');
  });

  it('an empty arm always fails, plan or not', () => {
    const g = minimumSampleGate(
      input({ targetNPerArm: null, arms: [arm({ assigned: 0 }), armB()] }),
    );
    expect(g.passed).toBe(false);
    expect(g.reason).toBe('A has no companies yet.');
  });
});

describe('runGates', () => {
  it('returns all eight, in the fixed order', () => {
    expect(runGates(input()).map((g) => g.id)).toEqual([
      'window_mature',
      'outcome_coverage',
      'assignment_balance',
      'delivery_balance',
      'attribution_clean',
      'copy_frozen',
      'guardrails',
      'minimum_sample',
    ]);
  });
});
