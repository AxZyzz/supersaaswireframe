import type { PoolClient } from 'pg';

// Starter templates seeded into every new workspace so the library and the
// campaign builder aren't empty on day one. Tokens use the {var|fallback}
// syntax (see render.ts). Idempotent via the unique (org, lower(name)) guard is
// NOT available here (templates allow duplicate names), so seeding runs only at
// org creation.
//
// Look: the app's light theme (Twenty CRM style): white card, hairline
// borders, Inter, indigo #3e63dd. Email-safe HTML only: table layout and
// inline styles (Gmail/Outlook drop <style> and most layout CSS), buttons are
// plain <a> links. Reply buttons are mailto: links to {sender_email}, so a
// click opens a reply that Gmail reply sync picks up like any other reply.
// The send pipeline appends the unsubscribe footer + open pixel after this.

const FONT =
  "font-family:Inter,-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;";
const INK = '#333333';
const MUTED = '#818181';
const LINE = '#ebebeb';
const ACCENT = '#3e63dd';
const ACCENT_SOFT = '#edf0fd';

const p = (html: string) =>
  `<p style="${FONT}margin:0 0 14px;font-size:15px;line-height:1.6;color:${INK};">${html}</p>`;

/** mailto: that opens a reply to the sender, with an optional prefilled line. */
const replyTo = (subject: string, body = '') =>
  `mailto:{sender_email}?subject=${encodeURIComponent(subject)}${
    body ? `&amp;body=${encodeURIComponent(body)}` : ''
  }`;

const primary = (label: string, href: string) =>
  `<a href="${href}" style="${FONT}display:inline-block;background:${ACCENT};color:#ffffff;text-decoration:none;font-size:14px;font-weight:600;line-height:20px;padding:10px 18px;border-radius:6px;margin:0 8px 8px 0;">${label}</a>`;

const secondary = (label: string, href: string) =>
  `<a href="${href}" style="${FONT}display:inline-block;background:#ffffff;color:${INK};text-decoration:none;font-size:14px;font-weight:600;line-height:20px;padding:9px 17px;border:1px solid #d6d6d6;border-radius:6px;margin:0 8px 8px 0;">${label}</a>`;

/** Small pill: one-tap quick replies ("Tuesday works", "Not now"...). */
const chip = (label: string, href: string) =>
  `<a href="${href}" style="${FONT}display:inline-block;background:${ACCENT_SOFT};color:${ACCENT};text-decoration:none;font-size:13px;font-weight:600;line-height:18px;padding:7px 14px;border-radius:999px;margin:0 6px 8px 0;">${label}</a>`;

const actions = (...buttons: string[]) =>
  `<div style="margin:6px 0 4px;">${buttons.join('')}</div>`;

const signature = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:20px;border-top:1px solid ${LINE};"><tr><td style="${FONT}padding-top:16px;font-size:14px;line-height:1.5;color:${INK};"><strong style="font-weight:600;">{sender_name}</strong><br><span style="color:${MUTED};">{sender_company|}</span></td></tr></table>`;

/** Outer canvas + white card. */
const shell = (inner: string) =>
  `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f7f7f8;"><tr><td align="center" style="padding:24px 12px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;background:#ffffff;border:1px solid ${LINE};border-radius:10px;"><tr><td style="padding:28px 32px;"><div style="${FONT}margin:0 0 18px;font-size:12px;font-weight:600;letter-spacing:0.04em;text-transform:uppercase;color:${ACCENT};">{sender_company|Hello}</div>${inner}${signature}</td></tr></table></td></tr></table>`;

/** Soft highlight block (e.g. a result in the case-study email). */
const highlight = (big: string, small: string) =>
  `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:4px 0 18px;background:${ACCENT_SOFT};border-radius:8px;"><tr><td style="${FONT}padding:16px 18px;"><div style="font-size:24px;font-weight:700;line-height:1.2;color:${ACCENT};">${big}</div><div style="margin-top:4px;font-size:13px;line-height:1.5;color:${INK};">${small}</div></td></tr></table>`;

const bullets = (items: string[]) =>
  `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 16px;">${items
    .map(
      (i) =>
        `<tr><td valign="top" style="${FONT}padding:0 10px 8px 0;font-size:15px;line-height:1.5;color:${ACCENT};">&#10003;</td><td style="${FONT}padding:0 0 8px;font-size:15px;line-height:1.5;color:${INK};">${i}</td></tr>`,
    )
    .join('')}</table>`;

export const DEFAULT_TEMPLATES: {
  name: string;
  subject: string;
  bodyHtml: string;
}[] = [
  {
    name: 'Cold intro',
    subject: 'Quick question, {first_name|there}',
    bodyHtml: shell(
      p('Hi {first_name|there},') +
        p(
          'I came across {business_name|your company} and thought there might be a fit. We help teams like yours run outbound without the manual grind.',
        ) +
        p('Open to a quick 15-minute call this week?') +
        actions(
          primary('Reply to {sender_name}', replyTo('Re: Quick question')),
          secondary('Visit our website', '{sender_website}'),
        ),
    ),
  },
  {
    name: 'Follow-up #1',
    subject: 'Re: Quick question, {first_name|there}',
    bodyHtml: shell(
      p('Hi {first_name|there},') +
        p(
          'Floating this back to the top of your inbox. Worth a short chat? One tap is enough:',
        ) +
        actions(
          chip(
            'Yes, let’s talk',
            replyTo('Re: Quick question', 'Yes, let’s talk.'),
          ),
          chip('Maybe later', replyTo('Re: Quick question', 'Maybe later.')),
          chip(
            'Not for us',
            replyTo('Re: Quick question', 'Not for us, thanks.'),
          ),
        ),
    ),
  },
  {
    name: 'Follow-up #2 (break-up)',
    subject: 'Should I close the loop?',
    bodyHtml: shell(
      p('Hi {first_name|there},') +
        p(
          'Haven’t heard back, so I’ll assume the timing isn’t right and stop following up.',
        ) +
        p('If it’s still on your radar, let me know where things stand:') +
        actions(
          chip(
            'Still interested',
            replyTo('Re: Should I close the loop?', 'Still interested.'),
          ),
          chip(
            'Check back next quarter',
            replyTo('Re: Should I close the loop?', 'Check back next quarter.'),
          ),
          chip(
            'Please close it',
            replyTo('Re: Should I close the loop?', 'Please close it.'),
          ),
        ),
    ),
  },
  {
    name: 'Meeting request',
    subject: '15 minutes, {first_name|there}?',
    bodyHtml: shell(
      p('Hi {first_name|there},') +
        p(
          'Would a quick 15-minute call work this week? Happy to work around {business_name|your team}’s schedule. Pick what suits you:',
        ) +
        actions(
          chip(
            'Tuesday works',
            replyTo('Re: 15 minutes', 'Tuesday works for me.'),
          ),
          chip(
            'Thursday works',
            replyTo('Re: 15 minutes', 'Thursday works for me.'),
          ),
          chip('Suggest another time', replyTo('Re: 15 minutes', 'How about ')),
        ),
    ),
  },
  {
    name: 'Value / case study',
    subject: 'How teams like {business_name|yours} save hours weekly',
    bodyHtml: shell(
      p('Hi {first_name|there},') +
        p(
          'A team similar to {business_name|yours} rebuilt their outreach with us last quarter:',
        ) +
        highlight(
          '50% less time on outreach',
          'Same pipeline, half the manual work, within the first month.',
        ) +
        bullets([
          'Leads, sequences and replies in one place',
          'AI drafts every follow-up; you approve',
          'Replies sorted automatically: interested, not now, out of office',
        ]) +
        p('Happy to show you how it would look for your team.') +
        actions(
          primary('See how it works', '{sender_website}'),
          secondary(
            'Reply to {sender_name}',
            replyTo('Re: Saving hours weekly'),
          ),
        ),
    ),
  },
];

// Must run inside an org-context transaction (RLS WITH CHECK needs
// app.current_org_id set to orgId).
export async function seedDefaultTemplates(
  client: PoolClient,
  orgId: string,
): Promise<void> {
  for (const t of DEFAULT_TEMPLATES) {
    await client.query(
      `INSERT INTO templates (org_id, name, subject, body_html)
       VALUES ($1, $2, $3, $4)`,
      [orgId, t.name, t.subject, t.bodyHtml],
    );
  }
}
