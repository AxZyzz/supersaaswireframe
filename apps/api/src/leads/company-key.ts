/**
 * Company key: the unit the learning loop counts. Two contacts at one company
 * are ONE unit, so the key is the company's website domain.
 *
 * Rules (kept simple on purpose, no public-suffix parsing):
 *  1. Use the website's domain if there is one, else the email's domain.
 *  2. Lowercase it, drop a leading `www.`, and drop ONE leading label if it is
 *     in MAIL_SUBDOMAINS (mail., app., ...). Any other subdomain is kept
 *     (`eu.acme.com` stays `eu.acme.com`).
 *  3. A free-mail domain (gmail, yahoo, ...) is not a company: that address is
 *     its own unit, `email:<lowercased address>`.
 *  4. No usable email and no usable website -> null (not experiment-eligible).
 */

/** Free mailboxes people use instead of a company domain. One list, shared
 *  with the Discover web reader. */
export const FREE_MAIL =
  /^(gmail|googlemail|yahoo|ymail|outlook|hotmail|live|msn|icloud|me|proton|protonmail|zoho|rediffmail|aol|gmx|yandex|mail|qq|pm)\.[a-z.]+$/i;

/** Leading labels that are mail/app hosts, not part of the company's name. */
const MAIL_SUBDOMAINS = new Set([
  'www',
  'mail',
  'email',
  'webmail',
  'smtp',
  'app',
  'm',
]);

export const isFreeMail = (domain: string) => FREE_MAIL.test(domain);

const DOMAIN_RE = /^[a-z0-9-]+(\.[a-z0-9-]+)+$/;

function cleanDomain(host: string): string | null {
  let h = host.toLowerCase().trim().replace(/\.$/, '');
  const parts = h.split('.');
  if (parts.length > 2 && MAIL_SUBDOMAINS.has(parts[0])) {
    h = parts.slice(1).join('.');
  }
  return DOMAIN_RE.test(h) ? h : null;
}

/** "https://www.Acme.com/x" or "acme.com" -> "acme.com"; junk -> null. */
export function websiteDomain(raw: string | null | undefined): string | null {
  const s = (raw ?? '').trim();
  if (!s) return null;
  try {
    const u = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(s) ? s : `https://${s}`);
    return cleanDomain(u.hostname);
  } catch {
    return null;
  }
}

/** The domain part of an email address, or null when it isn't one. */
export function emailDomain(email: string | null | undefined): string | null {
  const s = (email ?? '').trim().toLowerCase();
  const at = s.lastIndexOf('@');
  if (at < 1) return null;
  return cleanDomain(s.slice(at + 1));
}

export function companyKey(
  email: string | null | undefined,
  website?: string | null,
): string | null {
  const addr = (email ?? '').trim().toLowerCase();
  const eDomain = emailDomain(addr);
  const wDomain = websiteDomain(website);
  // A "website" that is really gmail.com etc. isn't the company's site.
  if (wDomain && !isFreeMail(wDomain)) return wDomain;
  if (eDomain) return isFreeMail(eDomain) ? `email:${addr}` : eDomain;
  return null;
}

/** The website a lead record carries (Discover and imports keep it in custom). */
export function leadWebsite(
  custom: Record<string, unknown> | null | undefined,
): string | null {
  const v = custom?.website ?? custom?.domain;
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}
