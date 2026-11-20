import {
  keys,
  outcomeCoverage,
  reasonRequired,
  VERIFIABLE_TYPES,
} from './outcome-logic';

describe('outcome logic (T03)', () => {
  it('outcomeCoverage = replying companies that are settled / replying companies', () => {
    expect(
      outcomeCoverage({ replyingCompanies: 10, settledCompanies: 9 }),
    ).toBe(0.9);
    expect(outcomeCoverage({ replyingCompanies: 4, settledCompanies: 1 })).toBe(
      0.25,
    );
  });

  it('coverage is 1 when nobody replied (nothing is waiting) and is clamped to 0..1', () => {
    expect(outcomeCoverage({ replyingCompanies: 0, settledCompanies: 0 })).toBe(
      1,
    );
    expect(outcomeCoverage({ replyingCompanies: 2, settledCompanies: 5 })).toBe(
      1,
    );
    expect(
      outcomeCoverage({ replyingCompanies: 2, settledCompanies: -1 }),
    ).toBe(0);
  });

  it('idempotency keys are stable for the same real-world event', () => {
    expect(keys.reply('<m1@x>')).toBe(keys.reply('<m1@x>'));
    expect(keys.qualified('c1')).toBe('qr:c1');
    expect(keys.bounce('s1')).toBe('bounce:s1');
    expect(keys.reply('a')).not.toBe(keys.reply('b'));
  });

  it('only judgements (qualified reply, booked call) can be verified; changing a decision needs a reason', () => {
    expect(VERIFIABLE_TYPES).toEqual(['qualified_reply', 'booked_call']);
    expect(reasonRequired('provisional')).toBe(false);
    expect(reasonRequired('verified')).toBe(true);
    expect(reasonRequired('rejected')).toBe(true);
  });
});
