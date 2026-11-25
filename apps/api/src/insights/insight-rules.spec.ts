import {
  buildInsights,
  confoundingHint,
  evaluateFactor,
  headlineMetric,
  MAX_HEADLINES,
  sendTimeStatus,
  starsCheck,
} from './insight-rules';
import { BLOCK_LABELS, blockOfHour, localSlot } from './send-time';
import type { BucketRow, FactorId } from './types';

const row = (
  bucket: string,
  reached: number,
  replied: number,
  over: Partial<BucketRow> = {},
  factor: FactorId = 'city',
): BucketRow => ({
  factor,
  bucket,
  sent: reached,
  reached,
  bounced: 0,
  opened: 0,
  replied,
  positive: replied,
  qualified: replied,
  booked: 0,
  unsubscribed: 0,
  medianHoursToReply: null,
  discovered: 0,
  eligible: 0,
  ...over,
});

describe('leader rule', () => {
  it('a clear winner is called best: Pune 12 of 146 (8.2%) beats the 3.4% overall', () => {
    const e = evaluateFactor(
      'city',
      [row('Pune', 146, 12), row('Mumbai', 150, 2), row('Delhi', 150, 1)],
      'reply',
    );
    expect(e.verdict).toBe('leader');
    expect(e.best?.bucket).toBe('Pune');
    expect(e.best?.status).toBe('best');
    expect(e.best?.p).toBeCloseTo(0.0822, 3);
    expect(e.best?.lo).toBeCloseTo(0.0476, 3);
    expect(e.best?.hi).toBeCloseTo(0.1382, 3);
    expect(e.overall.p).toBeCloseTo(0.0336, 3);
    expect(e.buckets.map((b) => b.bucket)).toEqual(['Pune', 'Mumbai', 'Delhi']);
  });

  it('overlapping rates: no clear leader, and the top bucket is shown in grey', () => {
    const e = evaluateFactor(
      'city',
      [row('Pune', 100, 8), row('Mumbai', 100, 6), row('Delhi', 100, 5)],
      'reply',
    );
    expect(e.verdict).toBe('no_clear_leader');
    expect(e.best).toBeNull();
    expect(e.topGrey?.bucket).toBe('Pune');
  });

  it('a bucket with fewer than 30 reached companies is never judged ("not enough data yet")', () => {
    const e = evaluateFactor(
      'city',
      [row('Pune', 29, 20), row('Mumbai', 200, 6), row('Delhi', 200, 6)],
      'reply',
    );
    expect(e.thin.map((b) => b.bucket)).toEqual(['Pune']);
    expect(e.thin[0].status).toBe('thin');
    expect(e.buckets.map((b) => b.bucket)).not.toContain('Pune');
    expect(e.best).toBeNull();
  });

  it('every bucket thin -> not_enough_data', () => {
    const e = evaluateFactor(
      'city',
      [row('Pune', 10, 5), row('Mumbai', 12, 1)],
      'reply',
    );
    expect(e.verdict).toBe('not_enough_data');
    expect(e.topGrey).toBeNull();
  });

  it('fewer than 3 events can never be "best", even with a high rate', () => {
    const e = evaluateFactor(
      'city',
      [row('Tiny', 30, 2), row('Big', 300, 3), row('Big2', 300, 3)],
      'reply',
    );
    // 2/30 = 6.7% is above the 1.3% overall but has only 2 events
    expect(e.best).toBeNull();
    expect(e.buckets.find((b) => b.bucket === 'Tiny')?.status).not.toBe('best');
  });

  it('a clearly worse bucket (upper bound below overall) is called worst', () => {
    const e = evaluateFactor(
      'city',
      [row('Pune', 400, 40), row('Mumbai', 400, 40), row('Delhi', 400, 1)],
      'reply',
    );
    expect(e.worst?.bucket).toBe('Delhi');
    expect(e.worst?.status).toBe('worst');
  });

  it('uses the chosen metric (qualified, booked, opens, interested)', () => {
    const rows = [
      row('A', 200, 20, { qualified: 1, booked: 0, opened: 100, positive: 5 }),
      row('B', 200, 20, {
        qualified: 30,
        booked: 12,
        opened: 20,
        positive: 40,
      }),
      row('C', 200, 20, { qualified: 1, booked: 0, opened: 80, positive: 5 }),
    ];
    expect(evaluateFactor('city', rows, 'qualified').best?.bucket).toBe('B');
    expect(evaluateFactor('city', rows, 'booked').best?.bucket).toBe('B');
    expect(evaluateFactor('city', rows, 'positive').best?.bucket).toBe('B');
    expect(evaluateFactor('city', rows, 'open').best?.bucket).toBe('A');
    expect(evaluateFactor('city', rows, 'reply').verdict).toBe(
      'no_clear_leader',
    );
  });

  it('carries the guardrail view: bounce and unsubscribe rates, median hours to reply', () => {
    const e = evaluateFactor(
      'city',
      [
        row('Pune', 100, 10, {
          sent: 110,
          bounced: 10,
          unsubscribed: 2,
          medianHoursToReply: 26,
        }),
      ],
      'reply',
    );
    expect(e.buckets[0].bounceRate).toBeCloseTo(10 / 110, 5);
    expect(e.buckets[0].unsubscribeRate).toBeCloseTo(0.02, 5);
    expect(e.buckets[0].medianHoursToReply).toBe(26);
  });

  it('an empty factor does not crash', () => {
    const e = evaluateFactor('city', [], 'reply');
    expect(e.verdict).toBe('not_enough_data');
    expect(e.overall.p).toBeNull();
  });
});

describe('headline insights', () => {
  const clear = (
    factor: FactorId,
    bucket: string,
    replied: number,
  ): BucketRow[] => [
    row(bucket, 300, replied, {}, factor),
    row('other1', 300, 3, {}, factor),
    row('other2', 300, 3, {}, factor),
  ];

  it('states the sentence with n, rate and range, and labels itself exploratory', () => {
    const e = evaluateFactor(
      'city',
      [row('Pune', 146, 12), row('Mumbai', 150, 2), row('Delhi', 150, 1)],
      'reply',
    );
    const [i] = buildInsights([e]);
    expect(i.sentence).toBe(
      'Most replies come from Pune: 8.2% (12 of 146 companies), range 4.8% to 13.8%. Overall: 3.4%.',
    );
    expect(i.exploratory).toContain('Observed among contacted companies');
    expect(i.exploratory).toContain('Test it before acting');
    expect([i.x, i.n]).toEqual([12, 146]);
  });

  it('shows at most 5, largest significant gap first, and skips factors without a clear leader', () => {
    const factors: FactorId[] = [
      'city',
      'industry',
      'role',
      'mail_provider',
      'lead_source',
      'sender',
      'country',
    ];
    const evals = factors.map((f, i) =>
      evaluateFactor(f, clear(f, 'top', 30 + i * 10), 'reply'),
    );
    evals.push(
      evaluateFactor(
        'region',
        [row('a', 100, 5, {}, 'region'), row('b', 100, 5, {}, 'region')],
        'reply',
      ),
    );
    const out = buildInsights(evals);
    expect(out).toHaveLength(MAX_HEADLINES);
    expect(out.map((i) => i.gap)).toEqual(
      [...out.map((i) => i.gap)].sort((a, b) => b - a),
    );
    expect(out.every((i) => i.factor !== 'region')).toBe(true);
    expect(buildInsights(evals, 2)).toHaveLength(2);
  });

  it('marks searchable factors (Test next batch) and opens as a diagnostic', () => {
    const city = buildInsights([
      evaluateFactor('city', clear('city', 'Pune', 40), 'reply'),
    ])[0];
    const role = buildInsights([
      evaluateFactor('role', clear('role', 'founder_owner', 40), 'reply'),
    ])[0];
    expect(city.searchable).toBe(true);
    expect(role.searchable).toBe(false);
    const opens = buildInsights([
      evaluateFactor(
        'city',
        [
          row('Pune', 300, 3, { opened: 150 }),
          row('X', 300, 3, { opened: 30 }),
          row('Y', 300, 3, { opened: 30 }),
        ],
        'open',
      ),
    ])[0];
    expect(opens.diagnostic).toBe(true);
    expect(opens.sentence).toContain('diagnostic');
  });

  it('non-geographic factors and non-reply metrics use the generic wording', () => {
    const i = buildInsights([
      evaluateFactor('role', clear('role', 'founder_owner', 40), 'qualified'),
    ])[0];
    expect(i.sentence).toContain(
      'Contact role: founder owner gets the most confirmed qualified replies',
    );
  });
});

describe('confounding hint (the Pune example)', () => {
  it('fires when 80% of a best city were also hiring, far above the 30% overall', () => {
    const hint = confoundingHint('city', {
      trigger: { value: 'hiring', share: 0.8, overallShare: 0.3 },
    });
    expect(hint).toBe(
      'Most of these were also hiring. Compare within trigger before deciding.',
    );
  });

  it('reads naturally and travels with the insight', () => {
    const e = evaluateFactor(
      'city',
      [
        row('Pune', 146, 12, {
          dominant: {
            trigger: { value: 'hiring', share: 0.8, overallShare: 0.3 },
          },
        }),
        row('Mumbai', 150, 2),
        row('Delhi', 150, 1),
      ],
      'reply',
    );
    const [i] = buildInsights([e]);
    expect(i.confounding).toContain('Compare within trigger before deciding.');
    expect(i.confounding).toContain('hiring');
  });

  it('stays quiet when the share is low, barely above everyone else, unknown, or the same factor', () => {
    expect(
      confoundingHint('city', {
        trigger: { value: 'hiring', share: 0.55, overallShare: 0.1 },
      }),
    ).toBeNull();
    expect(
      confoundingHint('city', {
        trigger: { value: 'hiring', share: 0.7, overallShare: 0.65 },
      }),
    ).toBeNull();
    expect(
      confoundingHint('city', {
        trigger: { value: 'unknown', share: 0.9, overallShare: 0.2 },
      }),
    ).toBeNull();
    expect(
      confoundingHint('trigger', {
        trigger: { value: 'hiring', share: 0.9, overallShare: 0.2 },
      }),
    ).toBeNull();
    expect(confoundingHint('city', undefined)).toBeNull();
  });

  it('phrases industry and city dominance too', () => {
    expect(
      confoundingHint('trigger', {
        industry: { value: 'healthcare_clinic', share: 0.8, overallShare: 0.3 },
      }),
    ).toContain('in healthcare clinic');
    expect(
      confoundingHint('industry', {
        city: { value: 'Pune', share: 0.9, overallShare: 0.3 },
      }),
    ).toContain('in Pune');
  });
});

describe('fit score (stars) check', () => {
  const stars = (r: Record<string, [number, number]>) =>
    Object.entries(r).map(([b, [n, x]]) => row(b, n, x, {}, 'stars'));

  it('warns when 4-5 stars do not clearly beat 1-2 stars', () => {
    const c = starsCheck(
      stars({ '1': [100, 8], '2': [100, 8], '4': [100, 7], '5': [100, 9] }),
    );
    expect(c.warn).toBe(true);
    expect(c.message).toContain("Our fit score isn't predicting replies");
  });

  it('is quiet when 4-5 stars clearly reply more', () => {
    const c = starsCheck(
      stars({ '1': [150, 3], '2': [150, 3], '4': [150, 30], '5': [150, 35] }),
    );
    expect(c.warn).toBe(false);
    expect(c.message).toBeNull();
    expect(c.high?.p).toBeGreaterThan(c.low?.p ?? 1);
  });

  it('says nothing without enough data on both sides', () => {
    expect(starsCheck(stars({ '1': [10, 1], '5': [200, 20] }))).toEqual({
      warn: false,
      message: null,
      high: null,
      low: null,
    });
    expect(starsCheck([])).toMatchObject({ warn: false });
  });
});

describe('send-time honesty', () => {
  it('only two blocks used: no comparison, names the hours, points to the send-time test', () => {
    const s = sendTimeStatus([2, 2, 3]);
    expect(s.comparable).toBe(false);
    expect(s.message).toContain("We've only sent between 10 am-12 and 12-2 pm");
    expect(s.message).toContain("can't compare times yet");
    expect(s.message).toContain('T17');
    expect(s.message).not.toMatch(/best time/i);
  });

  it('three or more blocks: times can be compared', () => {
    expect(sendTimeStatus([1, 2, 3]).comparable).toBe(true);
    expect(sendTimeStatus([1, 2, 3]).message).toBeNull();
  });

  it('no sends at all', () => {
    expect(sendTimeStatus([]).comparable).toBe(false);
    expect(sendTimeStatus([]).message).toContain('no send-time data');
  });
});

describe('headline metric', () => {
  it('leads with confirmed qualified replies once at least half are settled', () => {
    expect(headlineMetric({ positive: 10, qualified: 5 })).toBe('qualified');
    expect(headlineMetric({ positive: 10, qualified: 4 })).toBe('reply');
    expect(headlineMetric({ positive: 0, qualified: 0 })).toBe('reply');
  });
});

describe('timezone: send time in the recipient timezone', () => {
  it('04:30 UTC to Asia/Kolkata is 10:00, the 10 am-12 block (recipient basis)', () => {
    const s = localSlot(
      new Date('2026-12-02T04:30:00Z'),
      'Asia/Kolkata',
      'UTC',
    );
    expect(s).toEqual({ day: 2, hour: 10, block: 2, basis: 'recipient' });
    expect(BLOCK_LABELS[s.block as number]).toBe('10 am-12');
  });

  it('a null or invalid recipient timezone falls back to the workspace zone and says so', () => {
    const w = localSlot(new Date('2026-12-02T04:30:00Z'), null, 'Asia/Kolkata');
    expect(w).toMatchObject({ hour: 10, basis: 'workspace' });
    expect(
      localSlot(new Date('2026-12-02T04:30:00Z'), 'Not/AZone', 'UTC'),
    ).toMatchObject({
      hour: 4,
      basis: 'workspace',
    });
    expect(
      localSlot(new Date('2026-12-02T04:30:00Z'), undefined, 'also-bad'),
    ).toMatchObject({
      hour: 4,
      basis: 'workspace',
    });
  });

  it('the day follows the recipient: 22:00 UTC Monday is already Tuesday morning in Kolkata', () => {
    const s = localSlot(
      new Date('2026-11-30T22:00:00Z'),
      'Asia/Kolkata',
      'UTC',
    );
    expect(s.day).toBe(1); // Tuesday
    expect(s.hour).toBe(3);
    expect(s.block).toBeNull(); // 03:00 is outside 6-22
  });

  it('hour blocks: 6-8 is block 0, 21:59 is block 7, midnight and 5:59 are "other"', () => {
    expect(blockOfHour(6)).toBe(0);
    expect(blockOfHour(7)).toBe(0);
    expect(blockOfHour(8)).toBe(1);
    expect(blockOfHour(21)).toBe(7);
    expect(blockOfHour(22)).toBeNull();
    expect(blockOfHour(0)).toBeNull();
    expect(blockOfHour(5)).toBeNull();
  });
});
