import {
  cleanOpportunity,
  contactScore,
  scoreProspect,
  starsFor,
  verifyEvidence,
} from './scoring';
import {
  extractEmails,
  fetchPage,
  guardedLookup,
  htmlToText,
  normalizeDomain,
  parseRobots,
  robotsAllows,
  subpageLinks,
} from './web-reader';

describe('Expelly web reader', () => {
  it('refuses internal addresses before connecting', async () => {
    await expect(fetchPage('http://127.0.0.1/')).rejects.toThrow(/internal/);
    await expect(fetchPage('http://169.254.169.254/latest')).rejects.toThrow(
      /internal/,
    );
    await expect(fetchPage('http://localhost:8080/')).rejects.toThrow(
      /ports 80\/443/,
    );
    await expect(fetchPage('file:///etc/passwd')).rejects.toThrow(/http/);
    await expect(fetchPage('https://user:pw@example.com/')).rejects.toThrow(
      /credentials/,
    );
  });

  it('guarded lookup blocks a hostname that resolves inward', (done) => {
    guardedLookup('localhost', {}, (err) => {
      expect(err?.message).toMatch(/internal/);
      done();
    });
  });

  it('robots.txt: wildcards and anchors, only our groups', () => {
    const rules = parseRobots(
      [
        'User-agent: Googlebot',
        'Disallow: /',
        '',
        'User-agent: *',
        'Disallow: /*?',
        'Disallow: /admin',
        'Disallow: /*.pdf$',
      ].join('\n'),
    );
    expect(robotsAllows(rules, '/')).toBe(true);
    expect(robotsAllows(rules, '/about')).toBe(true);
    expect(robotsAllows(rules, '/search?q=x')).toBe(false);
    expect(robotsAllows(rules, '/admin/users')).toBe(false);
    expect(robotsAllows(rules, '/files/a.pdf')).toBe(false);
    expect(robotsAllows(parseRobots('User-agent: *\nDisallow: /'), '/')).toBe(
      false,
    );
  });

  it('extracts only addresses that literally appear on the page', () => {
    const html = `
      <a href="mailto:sales@acme.com">Sales</a> Write to hello&#64;acme.com
      <img src="logo@2x.png"> support@example.com x@sentry.io
      privacy%40acme.com <input placeholder="you@yourcompany.com">
      {"email":">press@acme.com"} name@acme.com`;
    expect(extractEmails(html).sort()).toEqual([
      'hello@acme.com',
      'press@acme.com',
      'privacy@acme.com',
      'sales@acme.com',
    ]);
  });

  it('turns HTML into readable text without scripts', () => {
    expect(
      htmlToText(
        '<h1>Acme</h1><script>evil()</script><p>We ship &amp; scale</p>',
      ),
    ).toBe('Acme\nWe ship & scale');
  });

  it('prefers contact and legal-notice pages on the same site', () => {
    const html = `<a href="/careers">Jobs</a><a href="/impressum">Impressum</a>
      <a href="https://other.com/contact">x</a><a href="/contact-us">Contact</a>
      <a href="/about">About</a>`;
    expect(subpageLinks(html, 'https://www.acme.de/', 3)).toEqual([
      'https://www.acme.de/contact-us',
      'https://www.acme.de/impressum',
      'https://www.acme.de/about',
    ]);
  });

  it('normalizes domains', () => {
    expect(normalizeDomain('https://www.Acme.com/x')).toBe('acme.com');
    expect(normalizeDomain('acme.co.uk')).toBe('acme.co.uk');
    expect(normalizeDomain('not a domain')).toBeNull();
  });
});

describe('Expelly scoring', () => {
  const pages = [
    {
      url: 'https://acme.com/',
      text: 'Acme builds  freight software.\nTrusted by 6,000+ shippers worldwide.',
    },
  ];

  it('keeps only facts whose quote is really on the cited (or a fetched) page', () => {
    const ev = verifyEvidence(
      [
        {
          fact: 'Large customer base',
          quote: 'Trusted by 6,000+ shippers',
          url: 'https://acme.com/',
        },
        {
          fact: 'Invented',
          quote: 'Losing 40% of leads every month',
          url: 'https://acme.com/',
        },
        {
          fact: 'Wrong url but real quote',
          quote: 'acme builds freight software',
          url: 'https://acme.com/nope',
        },
        { fact: 'Too short', quote: 'Acme', url: 'https://acme.com/' },
      ],
      pages,
    );
    expect(ev.map((e) => e.fact)).toEqual([
      'Large customer base',
      'Wrong url but real quote',
    ]);
    expect(ev[1].url).toBe('https://acme.com/');
  });

  it('computes stars on the server; contact readiness from real emails only', () => {
    const r = scoreProspect(
      { icp: 99, opportunity: 20, timing: -5, commercial: '10' },
      [{ email: 'a@acme.com', url: 'u', onCompanyDomain: true, mx: true }],
    );
    expect(r.parts).toEqual({
      icp: 30,
      opportunity: 20,
      timing: 0,
      commercial: 10,
      contact: 10,
    });
    expect(r.total).toBe(70);
    expect(r.stars).toBe(4);
    expect(contactScore([])).toBe(0);
    expect(starsFor(81)).toBe(5);
    expect(starsFor(20)).toBe(1);
  });

  it('drops an opportunity without a hypothesis', () => {
    expect(cleanOpportunity({ service: 'x' })).toBeNull();
    expect(cleanOpportunity({ hypothesis: 'h', service: 's' })).toEqual({
      hypothesis: 'h',
      service: 's',
      discoveryQuestion: '',
    });
  });
});
