import type { ReviewAnalystInput, ReviewAnalystOutput } from './contracts';
import { fixture } from './fixtures';
import {
  numbersIn,
  unsupportedNumber,
  validateExplanation,
} from './explanation-validator';

const input = () => fixture<ReviewAnalystInput>('review-analyst-input.valid');
const valid = () => fixture<ReviewAnalystOutput>('review-analyst-output.valid');

describe('explanation validator (the API does not trust the agent)', () => {
  it('accepts a correct explanation', () => {
    const r = validateExplanation(valid(), input());
    expect(r.ok).toBe(true);
  });

  it('rejects a hallucinated number (9.0% where the finding says 4.2%) -> template', () => {
    const r = validateExplanation(
      fixture('review-analyst-output.hallucinated-number'),
      input(),
    );
    expect(r.ok).toBe(false);
    if (!r.ok)
      expect(r.reason).toMatch(
        /number 9 is not in the cited findings \(F2, F1\)/,
      );
  });

  it('rejects a finding id that does not exist', () => {
    const r = validateExplanation(
      fixture('review-analyst-output.unknown-finding'),
      input(),
    );
    expect(r).toEqual({ ok: false, reason: 'cites unknown finding F9' });
  });

  it('rejects "winner" when the decision is inconclusive', () => {
    const r = validateExplanation(
      fixture('review-analyst-output.premature-winner'),
      input(),
    );
    expect(r.ok).toBe(false);
    if (!r.ok)
      expect(r.reason).toMatch(
        /says "winner" but the decision is inconclusive/,
      );
  });

  it('allows "no clear winner yet" and "can\'t call a winner" (negated)', () => {
    // the valid fixture already says both
    expect(valid().summary).toMatch(/No clear winner/);
    expect(JSON.stringify(valid().points)).toMatch(/can't call a winner/);
    expect(validateExplanation(valid(), input()).ok).toBe(true);
  });

  it('allows "winner" when the decision is promote', () => {
    const ev = { ...input(), decision: 'promote' as const };
    const out = valid();
    out.summary = 'Keep B: it is the winner, and the lift is +1.7 points.';
    out.points = [out.points[0]];
    expect(validateExplanation(out, ev).ok).toBe(true);
  });

  it('rejects a next step the review does not allow', () => {
    const out = {
      ...valid(),
      suggestedNextStep: 'apply_to_next_search' as const,
    };
    const r = validateExplanation(out, input());
    expect(r).toEqual({
      ok: false,
      reason: 'suggested step apply_to_next_search is not an allowed action',
    });
    // allowed once the review offers it
    const ev = input();
    ev.allowedActions.push({ type: 'test_next_batch' });
    expect(validateExplanation(out, ev).ok).toBe(true);
    // "none" is always fine
    expect(
      validateExplanation({ ...valid(), suggestedNextStep: 'none' }, input())
        .ok,
    ).toBe(true);
  });

  it('rejects schema-invalid output (too many points, missing fields, extra fields)', () => {
    const six = valid();
    six.points = Array.from({ length: 6 }, () => six.points[0]);
    expect(validateExplanation(six, input()).ok).toBe(false);
    expect(validateExplanation({ summary: 'x' }, input()).ok).toBe(false);
    expect(validateExplanation('not json', input()).ok).toBe(false);
    expect(validateExplanation({ ...valid(), extra: 1 }, input()).ok).toBe(
      false,
    );
  });

  it('rejects a summary over 80 words', () => {
    const out = valid();
    out.summary = Array.from({ length: 81 }, () => 'word').join(' ');
    const r = validateExplanation(out, input());
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/longer than 80 words/);
  });

  it('checks numbers in the summary and caveats against all the evidence', () => {
    const out = valid();
    out.summary = 'No clear winner yet. About 7777 companies would settle it.';
    expect(validateExplanation(out, input()).ok).toBe(false);
    const cav = valid();
    cav.caveats = ['Reply rate was 88%.'];
    expect(validateExplanation(cav, input()).ok).toBe(false);
  });
});

describe('number checking', () => {
  it('reads percentages, signed points, thousands separators and ignores finding ids', () => {
    expect(
      numbersIn(
        'B got 4.2% (F2); lift +1.7 points, range −2.1 to +5.5; 1,500 needed',
      ),
    ).toEqual([4.2, 1.7, 2.1, 5.5, 1500]);
  });

  it('matches a fraction finding as a percentage within 0.1', () => {
    const f = { id: 'F1', kind: 'rate', p: 0.0424 };
    expect(unsupportedNumber('4.2%', [f])).toBeNull();
    expect(unsupportedNumber('4.4%', [f])).toBe(4.4);
  });
});
