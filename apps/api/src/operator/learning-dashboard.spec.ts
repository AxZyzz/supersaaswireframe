import { learningDashboardUrl } from './learning-dashboard';

describe('learningDashboardUrl (T16)', () => {
  const REPORT =
    'https://lookerstudio.google.com/reporting/0b1c2d3e-aaaa-bbbb-cccc-1234567890ab/page/xYz';

  it('returns a Looker Studio report address as it is', () => {
    expect(learningDashboardUrl(REPORT)).toBe(REPORT);
    expect(learningDashboardUrl(`  ${REPORT}  `)).toBe(REPORT);
    expect(
      learningDashboardUrl('https://datastudio.google.com/reporting/abc'),
    ).toBe('https://datastudio.google.com/reporting/abc');
  });

  it('is not set when empty', () => {
    expect(learningDashboardUrl(undefined)).toBeNull();
    expect(learningDashboardUrl('')).toBeNull();
    expect(learningDashboardUrl('   ')).toBeNull();
  });

  it('never returns anything that is not an https Looker Studio address', () => {
    for (const bad of [
      'http://lookerstudio.google.com/reporting/abc',
      'https://evil.example.com/reporting/abc',
      'https://lookerstudio.google.com.evil.example.com/reporting/abc',
      'https://user:pass@lookerstudio.google.com/reporting/abc',
      'javascript:alert(1)',
      'lookerstudio.google.com/reporting/abc',
      'not a url',
    ]) {
      expect(learningDashboardUrl(bad)).toBeNull();
    }
  });
});
