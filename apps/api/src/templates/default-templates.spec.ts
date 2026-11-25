import { buildEmail } from '../sending/send-render';
import { DEFAULT_TEMPLATES } from './default-templates';
import { SAMPLE_VARS, TEMPLATE_VARS, websiteUrl } from './render';

const TOKEN = /\{(\w+)(?:\|[^}]*)?\}/g;

const build = (t: (typeof DEFAULT_TEMPLATES)[number]) =>
  buildEmail({
    subject: t.subject,
    bodyHtml: t.bodyHtml,
    vars: SAMPLE_VARS,
    baseUrl: 'https://api.example',
    trackingId: '00000000-0000-0000-0000-000000000000',
    unsubToken: 'tok',
    sender: { name: 'Your Company', postalAddress: '1 Main St' },
  });

describe('starter HTML templates', () => {
  it('ships the five starters with the same names and subjects', () => {
    expect(DEFAULT_TEMPLATES.map((t) => t.name)).toEqual([
      'Cold intro',
      'Follow-up #1',
      'Follow-up #2 (break-up)',
      'Meeting request',
      'Value / case study',
    ]);
  });

  it.each(DEFAULT_TEMPLATES.map((t) => [t.name, t] as const))(
    '%s only uses known tokens and renders with none left over',
    (_name, t) => {
      const used = [...`${t.subject} ${t.bodyHtml}`.matchAll(TOKEN)].map(
        (m) => m[1],
      );
      expect(used.filter((v) => !TEMPLATE_VARS.includes(v as never))).toEqual(
        [],
      );
      const e = build(t);
      expect(e.subject).not.toMatch(TOKEN);
      expect(e.html).not.toMatch(TOKEN);
    },
  );

  it.each(DEFAULT_TEMPLATES.map((t) => [t.name, t] as const))(
    '%s: reply buttons are untracked mailto: to the sender, web links are click-tracked',
    (_name, t) => {
      const e = build(t);
      const mailtos = e.html.match(/href="mailto:[^"]+"/g) ?? [];
      expect(mailtos.length).toBeGreaterThan(0);
      for (const m of mailtos) {
        expect(m).toContain(`mailto:${SAMPLE_VARS.sender_email}?subject=`);
      }
      // every http(s) link in the body went through the click redirect
      // (the unsubscribe link is the only direct one)
      const direct = (e.html.match(/href="https?:\/\/[^"]+"/g) ?? []).filter(
        (h) => !h.includes('/t/c/') && !h.includes('/u/'),
      );
      expect(direct).toEqual([]);
    },
  );

  it('email-safe markup: tables + inline styles, no <style>/<script>, max 560px card', () => {
    for (const t of DEFAULT_TEMPLATES) {
      expect(t.bodyHtml).not.toMatch(/<(style|script|link)\b/i);
      expect(t.bodyHtml).not.toMatch(/\sclass=/i);
      expect(t.bodyHtml).toContain('max-width:560px');
    }
  });

  it('website buttons use the workspace website token', () => {
    const withSite = DEFAULT_TEMPLATES.filter((t) =>
      t.bodyHtml.includes('{sender_website}'),
    );
    expect(withSite.map((t) => t.name)).toEqual([
      'Cold intro',
      'Value / case study',
    ]);
  });
});

describe('websiteUrl', () => {
  it('adds https:// to a bare domain and keeps full URLs', () => {
    expect(websiteUrl('acme.com')).toBe('https://acme.com');
    expect(websiteUrl('  www.acme.com ')).toBe('https://www.acme.com');
    expect(websiteUrl('http://acme.com/x')).toBe('http://acme.com/x');
    expect(websiteUrl('HTTPS://acme.com')).toBe('HTTPS://acme.com');
  });

  it('is null when there is no website', () => {
    expect(websiteUrl(null)).toBeNull();
    expect(websiteUrl(undefined)).toBeNull();
    expect(websiteUrl('   ')).toBeNull();
  });
});
