import { buildEmail } from './send-render';

const base = {
  baseUrl: 'https://app.test',
  trackingId: 'trk-123',
  unsubToken: 'unsub-abc',
};

describe('buildEmail', () => {
  it('substitutes vars, wraps links, adds pixel + unsubscribe', () => {
    const out = buildEmail({
      ...base,
      subject: 'Hi {first_name|there}',
      bodyHtml: '<p>Hi {first_name}</p><a href="https://acme.com/x">link</a>',
      vars: { first_name: 'Sam' },
    });

    expect(out.subject).toBe('Hi Sam');
    // link click-wrapped
    expect(out.html).toContain(
      'href="https://app.test/t/c/trk-123?u=' +
        encodeURIComponent('https://acme.com/x'),
    );
    // open pixel present
    expect(out.html).toContain('https://app.test/t/o/trk-123');
    // unsubscribe footer + header value
    expect(out.html).toContain('https://app.test/u/unsub-abc');
    expect(out.listUnsubscribe).toBe('<https://app.test/u/unsub-abc>');
    // plain-text alternative is tag-free and carries the unsub URL
    expect(out.text).toContain('Hi Sam');
    expect(out.text).not.toContain('<p>');
    expect(out.text).toContain('Unsubscribe: https://app.test/u/unsub-abc');
  });

  it('falls back to the subject fallback token when var missing', () => {
    const out = buildEmail({
      ...base,
      subject: 'Hi {first_name|there}',
      bodyHtml: '<p>x</p>',
      vars: {},
    });
    expect(out.subject).toBe('Hi there');
  });
});
