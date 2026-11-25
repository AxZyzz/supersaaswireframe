import { countryCode, timezoneFor } from '../prospects/attributes';
import { companyKey, leadWebsite } from './company-key';

/**
 * What a lead record derives from its own data (Learning Loop T01): the
 * company key plus location and timezone. One function, called by every path
 * that creates or changes a lead (manual, API, CSV/Excel/Sheets import,
 * Discover add-to-leads, edit, backfill) so they can't drift apart.
 */
export interface LeadAttrs {
  companyKey: string | null;
  city: string | null;
  region: string | null;
  country: string | null; // ISO-2 when recognised, else the text as given
  timezone: string | null;
}

const text = (v: unknown, max = 80): string | null =>
  typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null;

/**
 * Location a lead carries: explicit columns win, then `custom` keys
 * (city, region/state, country), then a "City, Region, Country" `location`.
 */
function leadLocation(
  custom: Record<string, unknown>,
  explicit: {
    city?: string | null;
    region?: string | null;
    country?: string | null;
  },
) {
  let city = text(explicit.city) ?? text(custom.city);
  let region =
    text(explicit.region) ?? text(custom.region) ?? text(custom.state);
  let country = text(explicit.country) ?? text(custom.country);
  const loc = text(custom.location, 200);
  if (loc && !city && !region && !country) {
    const parts = loc
      .split(',')
      .map((p) => p.trim())
      .filter(Boolean);
    if (parts.length >= 2 && countryCode(parts[parts.length - 1])) {
      country = parts[parts.length - 1];
      city = parts[0];
      if (parts.length >= 3) region = parts[1];
    }
  }
  const code = country ? countryCode(country) : null;
  return { city, region, country: code ?? country };
}

export function deriveLeadAttrs(input: {
  email?: string | null;
  custom?: Record<string, unknown> | null;
  website?: string | null;
  city?: string | null;
  region?: string | null;
  country?: string | null;
}): LeadAttrs {
  const custom = input.custom ?? {};
  const loc = leadLocation(custom, input);
  return {
    companyKey: companyKey(input.email, input.website ?? leadWebsite(custom)),
    ...loc,
    timezone: timezoneFor(loc.country, loc.city),
  };
}
