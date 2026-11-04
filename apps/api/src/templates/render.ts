// Personalization tokens: {var} and {var|fallback}. Only whitelisted vars are
// substituted; unknown tokens are left literal so typos surface in preview
// rather than silently blanking. Used by preview, test-send, and (later) the
// E5 send pipeline.

export const TEMPLATE_VARS = [
  'first_name',
  'last_name',
  'company',
  'business_name',
  'title',
  'email',
  'phone',
  'sender_name',
] as const;

export type TemplateVar = (typeof TEMPLATE_VARS)[number];
export type TemplateVars = Partial<Record<TemplateVar, string | null>>;

const TOKEN = /\{(\w+)(?:\|([^}]*))?\}/g;

const HTML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};
export const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (c) => HTML_ESCAPES[c]);

/**
 * Fills {var} tokens. In an HTML body pass `{ html: true }`: values come from
 * lead data (CSV, Sheets, the public API, i.e. outsiders), so they're escaped
 * and can't inject links or markup into an email we send. Fallbacks are the
 * template author's own text and stay as written.
 */
export function renderTemplate(
  text: string,
  vars: TemplateVars,
  opts: { html?: boolean } = {},
): string {
  return text.replace(
    TOKEN,
    (match: string, name: string, fallback?: string) => {
      if (!(TEMPLATE_VARS as readonly string[]).includes(name)) return match;
      const v = vars[name as TemplateVar];
      if (v !== undefined && v !== null && v !== '') {
        return opts.html ? escapeHtml(v) : v;
      }
      return fallback ?? '';
    },
  );
}

// Build the token bag from a lead-like row. business_name aliases company.
export function varsFromLead(lead: {
  first_name?: string | null;
  last_name?: string | null;
  company?: string | null;
  title?: string | null;
  email?: string | null;
  phone?: string | null;
}): TemplateVars {
  return {
    first_name: lead.first_name ?? null,
    last_name: lead.last_name ?? null,
    company: lead.company ?? null,
    business_name: lead.company ?? null,
    title: lead.title ?? null,
    email: lead.email ?? null,
    phone: lead.phone ?? null,
  };
}

// Placeholder data for previews / test-sends when no real lead is chosen.
export const SAMPLE_VARS: TemplateVars = {
  first_name: 'Alex',
  last_name: 'Rivera',
  company: 'Acme Corp',
  business_name: 'Acme Corp',
  title: 'Head of Growth',
  email: 'alex@acme.com',
  phone: '+1 555 0142',
  sender_name: 'Jordan Lee',
};
