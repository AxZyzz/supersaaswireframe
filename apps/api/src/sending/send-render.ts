import { renderTemplate, TemplateVars } from '../templates/render';

export interface BuiltEmail {
  subject: string;
  html: string;
  text: string;
  listUnsubscribe: string; // value for the List-Unsubscribe header
}

interface BuildArgs {
  subject: string; // chosen subject template (variant or template subject)
  bodyHtml: string;
  vars: TemplateVars;
  baseUrl: string;
  trackingId: string;
  unsubToken: string;
  // CAN-SPAM sender identity for the footer (workspace name + postal address).
  sender?: { name: string; postalAddress: string | null };
}

const escapeHtml = (s: string) =>
  s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

// Turns a template body into the final send-ready email:
//  - substitutes personalization tokens
//  - rewrites outbound links through the click-redirect endpoint
//  - appends an open-tracking pixel
//  - appends an unsubscribe footer + returns the List-Unsubscribe value
// The /t/o, /t/c and /u endpoints are served in E5 chunk 2.
export function buildEmail(args: BuildArgs): BuiltEmail {
  const { subject, bodyHtml, vars, baseUrl, trackingId, unsubToken, sender } =
    args;
  const identity = sender
    ? [sender.name, sender.postalAddress].filter(Boolean).join(' · ')
    : '';
  const unsubUrl = `${baseUrl}/u/${unsubToken}`;

  let html = renderTemplate(bodyHtml, vars);

  // Click-wrap absolute http(s) links (skip mailto: and already-wrapped).
  html = html.replace(
    /href="(https?:\/\/[^"]+)"/g,
    (_m, url: string) =>
      `href="${baseUrl}/t/c/${trackingId}?u=${encodeURIComponent(url)}"`,
  );

  const pixel = `<img src="${baseUrl}/t/o/${trackingId}" width="1" height="1" alt="" style="display:none" />`;
  const footer = `<p style="font-size:12px;color:#888;margin-top:24px">${
    identity ? `${escapeHtml(identity)}<br>` : ''
  }Don't want these emails? <a href="${unsubUrl}">Unsubscribe</a>.</p>`;
  html = `${html}${footer}${pixel}`;

  const bodyText = renderTemplate(bodyHtml, vars)
    .replace(/<[^>]+>/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  const text = `${bodyText}\n\n${identity ? `${identity}\n` : ''}Unsubscribe: ${unsubUrl}`;

  return {
    subject: renderTemplate(subject, vars),
    html,
    text,
    listUnsubscribe: `<${unsubUrl}>`,
  };
}
