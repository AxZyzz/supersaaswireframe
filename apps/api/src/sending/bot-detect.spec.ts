import { botReason, PREFETCH_WINDOW_MS } from './bot-detect';

const CHROME =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';

describe('botReason (T5.4)', () => {
  const sent = new Date('2026-11-03T10:00:00Z');
  const later = sent.getTime() + 5 * 60_000;

  it('treats a normal browser minutes after send as human', () => {
    expect(botReason(CHROME, sent, later)).toBeNull();
  });

  it('flags missing and scanner user agents', () => {
    expect(botReason(undefined, sent, later)).toBe('no_user_agent');
    expect(botReason('  ', sent, later)).toBe('no_user_agent');
    for (const ua of [
      'Mozilla/5.0 (compatible; Barracuda Sentinel)',
      'python-requests/2.31',
      'curl/8.4.0',
      'Microsoft Office Protection',
      'Mimecast URL Protect',
      'Go-http-client/1.1',
    ]) {
      expect(botReason(ua, sent, later)).toBe('scanner_user_agent');
    }
  });

  it('flags delivery-time prefetch even from a browser-like agent', () => {
    expect(botReason(CHROME, sent, sent.getTime() + 2_000)).toBe('prefetch');
    expect(
      botReason(CHROME, sent, sent.getTime() + PREFETCH_WINDOW_MS + 1),
    ).toBeNull();
  });

  it("counts Gmail's image proxy as a real open", () => {
    const gmail =
      'Mozilla/5.0 (Windows NT 5.1; rv:11.0) Gecko Firefox/11.0 (via ggpht.com GoogleImageProxy)';
    expect(botReason(gmail, sent, later)).toBeNull();
  });
});
