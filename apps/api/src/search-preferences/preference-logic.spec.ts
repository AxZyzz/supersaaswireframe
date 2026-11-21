import {
  type Allocation,
  allocationLine,
  type ArmStats,
  autoDeactivateReason,
  decideResults,
  describeFilter,
  evidenceHash,
  matchesFactor,
  reservedSlots,
} from './preference-logic';

const arm = (over: Partial<ArmStats> = {}): ArmStats => ({
  discovered: 200,
  contactable: 180,
  sent: 200,
  reached: 200,
  bounced: 0,
  qualified: 0,
  positive: 0,
  ...over,
});

describe('search preference rules (T12)', () => {
  describe('cap math', () => {
    it('reserves floor(batch x share), never more than 20%', () => {
      expect(reservedSlots(50, 0.2)).toBe(10);
      expect(reservedSlots(20, 0.2)).toBe(4);
      expect(reservedSlots(12, 0.2)).toBe(2);
      expect(reservedSlots(15, 0.2)).toBe(3); // 15 x 0.2 = 3.0000000000000004
      expect(reservedSlots(5, 0.2)).toBe(1);
      expect(reservedSlots(4, 0.2)).toBe(0); // too small to reserve a slot
      expect(reservedSlots(50, 0.9)).toBe(10); // clamped to the 20% cap
      expect(reservedSlots(0, 0.2)).toBe(0);
      expect(reservedSlots(10, 0)).toBe(0);
    });
  });

  describe('does a company really match?', () => {
    const base = {
      status: 'verified',
      city: 'Pune',
      region: null,
      country: 'IN',
      industry: 'healthcare_clinic',
      size_band: '11-50',
      triggers: [{ type: 'expansion', quote: 'We are opening a new branch' }],
    };

    it('uses what the website confirmed, case-insensitively', () => {
      expect(matchesFactor('city', 'pune', base)).toBe(true);
      expect(matchesFactor('city', 'Mumbai', base)).toBe(false);
      expect(matchesFactor('country', 'IN', base)).toBe(true);
      expect(matchesFactor('trigger', 'expansion', base)).toBe(true);
      expect(matchesFactor('trigger', 'hiring', base)).toBe(false);
      expect(matchesFactor('industry', 'healthcare_clinic', base)).toBe(true);
      expect(matchesFactor('industry', 'healthcare clinic', base)).toBe(true);
      expect(matchesFactor('size_band', '11-50', base)).toBe(true);
    });

    it('an unverified or unknown company never counts', () => {
      expect(
        matchesFactor('city', 'Pune', { ...base, status: 'rejected' }),
      ).toBe(false);
      expect(matchesFactor('city', 'Pune', { ...base, city: null })).toBe(
        false,
      );
      expect(
        matchesFactor('trigger', 'expansion', { ...base, triggers: [] }),
      ).toBe(false);
    });

    it('describes the condition in plain words for the search prompt', () => {
      expect(describeFilter('city', 'Pune')).toContain('Pune');
      expect(describeFilter('trigger', 'product_launch')).toContain(
        'product launch',
      );
    });
  });

  it('the same evidence always has the same hash, and any change makes a new one', () => {
    const e = {
      offerId: 'o',
      factor: 'city',
      value: 'Pune',
      metric: 'reply',
      x: 12,
      n: 200,
    };
    expect(evidenceHash(e)).toBe(evidenceHash({ ...e }));
    expect(evidenceHash(e)).not.toBe(evidenceHash({ ...e, x: 13 }));
    expect(evidenceHash(e)).not.toBe(evidenceHash({ ...e, value: 'Mumbai' }));
  });

  describe('the line under a Discover run', () => {
    const a: Allocation = {
      batchSize: 12,
      cap: 2,
      capShare: 0.2,
      factor: 'trigger',
      value: 'expansion',
      label: 'Buying trigger: expansion',
      targetedRequested: 4,
      targetedFound: 1,
      targetedKept: 1,
      shortfall: 1,
      baselineFilled: 1,
      dedupedOverlap: 0,
      finalized: true,
    };
    it('says how many were found and what filled the gap', () => {
      expect(allocationLine(a)).toBe(
        '20% reserved for Buying trigger: expansion: found 1 of 2, 1 filled from the normal search.',
      );
      expect(allocationLine({ ...a, targetedKept: 2, shortfall: 0 })).toBe(
        '20% reserved for Buying trigger: expansion: found 2 of 2.',
      );
      expect(
        allocationLine({ ...a, skipped: 'the batch is too small.' }),
      ).toContain('Preference not used');
    });
  });

  describe('did it work? (spec worked example, illustrative numbers)', () => {
    it('12 of 200 vs 5 of 200: a promising lift, not yet proven -> test the next batch', () => {
      const v = decideResults(
        arm({ qualified: 12, positive: 12 }),
        arm({ qualified: 5, positive: 5 }),
        { windowOpen: false },
      );
      expect(v.qualifiedPerReached.targeted).toBeCloseTo(0.06, 5);
      expect(v.qualifiedPerReached.baseline).toBeCloseTo(0.025, 5);
      expect(v.diff?.d).toBeCloseTo(0.035, 5);
      expect(v.diff!.lo).toBeLessThan(0.02);
      expect(v.state).toBe('test_next_batch');
    });

    it('a clear lift (cautious end above +2 points) -> apply temporary (extend)', () => {
      const v = decideResults(
        arm({ qualified: 40, positive: 40 }),
        arm({ qualified: 8, positive: 8 }),
        { windowOpen: false },
      );
      expect(v.diff!.lo).toBeGreaterThanOrEqual(0.02);
      expect(v.state).toBe('apply_temporary');
    });

    it('keeps collecting while a window is open, with too little data, or with replies unconfirmed', () => {
      expect(
        decideResults(
          arm({ qualified: 12, positive: 12 }),
          arm({ qualified: 5, positive: 5 }),
          {
            windowOpen: true,
          },
        ).state,
      ).toBe('keep_collecting');
      expect(
        decideResults(
          arm({ reached: 20, qualified: 3, positive: 3 }),
          arm({ reached: 200, qualified: 5, positive: 5 }),
          { windowOpen: false },
        ).state,
      ).toBe('keep_collecting');
      const unconfirmed = decideResults(
        arm({ qualified: 5, positive: 12 }),
        arm({ qualified: 5, positive: 5 }),
        { windowOpen: false },
      );
      expect(unconfirmed.state).toBe('keep_collecting');
      expect(unconfirmed.reasons.join(' ')).toMatch(/confirmed by a person/);
    });

    it('a guardrail breach or a clearly worse result -> revert', () => {
      const bounce = decideResults(
        arm({ sent: 100, bounced: 9, reached: 91 }),
        arm(),
        {
          windowOpen: false,
        },
      );
      expect(bounce.state).toBe('revert');
      expect(bounce.reasons[0]).toMatch(/bounced/);
      expect(
        decideResults(
          arm({ qualified: 2, positive: 2 }),
          arm({ qualified: 30, positive: 30 }),
          { windowOpen: false },
        ).state,
      ).toBe('revert');
    });
  });

  describe('switching itself off', () => {
    it('trips on a high bounce rate once enough companies were sent', () => {
      expect(
        autoDeactivateReason(arm({ sent: 40, bounced: 4 }), arm(), 3),
      ).toMatch(/bounced 10\.0%/);
      expect(
        autoDeactivateReason(arm({ sent: 10, bounced: 5 }), arm(), 3),
      ).toBeNull();
      expect(
        autoDeactivateReason(arm({ sent: 40, bounced: 1 }), arm(), 3),
      ).toBeNull();
    });

    it('trips when outcome tracking looks broken after a week, not before', () => {
      const broken = arm({ qualified: 1, positive: 10 });
      expect(autoDeactivateReason(broken, arm(), 3)).toBeNull();
      expect(autoDeactivateReason(broken, arm(), 8)).toMatch(
        /confirmed by a person/,
      );
      expect(
        autoDeactivateReason(arm({ qualified: 10, positive: 10 }), arm(), 8),
      ).toBeNull();
    });
  });
});
