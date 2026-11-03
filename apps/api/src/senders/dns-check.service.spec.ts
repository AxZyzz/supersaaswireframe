import { DnsCheckService } from './dns-check.service';

/** SPF / DMARC / DKIM parsing against a fake resolver (no network). */
describe('DnsCheckService', () => {
  const svc = (zone: Record<string, string[][]>) => {
    const s = new DnsCheckService();
    s.resolveTxt = (name) =>
      zone[name]
        ? Promise.resolve(zone[name])
        : Promise.reject(Object.assign(new Error('nx'), { code: 'ENOTFOUND' }));
    return s;
  };

  it('finds SPF (joining split TXT chunks) and DMARC', async () => {
    const r = await svc({
      'acme.com': [
        ['google-site-verification=x'],
        ['v=spf1 include:', '_spf.google.com ~all'],
      ],
      '_dmarc.acme.com': [['v=DMARC1; p=none']],
    }).check('  HTTPS://Acme.com ');
    expect(r.domain).toBe('acme.com');
    expect(r.spf).toMatchObject({
      found: true,
      record: 'v=spf1 include:_spf.google.com ~all',
    });
    expect(r.spf.detail).toMatch(/Add `include:amazonses.com`/);
    expect(r.dmarc).toMatchObject({ found: true, record: 'v=DMARC1; p=none' });
    expect(r.dkim.found).toBe(false); // selector-specific: guidance only
  });

  it('recognises an SPF record that already authorises SES', async () => {
    const r = await svc({
      'acme.com': [['v=spf1 include:amazonses.com ~all']],
    }).check('acme.com');
    expect(r.spf.detail).toMatch(/already authorizes Amazon SES/);
  });

  it('reports missing records with the fix to apply', async () => {
    const r = await svc({}).check('nothing.example');
    expect(r.spf).toMatchObject({ found: false, record: null });
    expect(r.spf.detail).toMatch(/v=spf1 include:amazonses.com ~all/);
    expect(r.dmarc).toMatchObject({ found: false, record: null });
    expect(r.dmarc.detail).toMatch(/_dmarc/);
  });
});
