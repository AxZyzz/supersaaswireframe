import { companyKey, leadWebsite } from '../leads/company-key';

/**
 * Learning Loop T02: frozen factor snapshot saved on campaign_leads at
 * enrollment time. Written once in the enrollment transaction, never updated
 * later even if the lead or prospect record is edited.
 */

export const ROLE_BUCKETS = [
  'founder_owner',
  'c_level',
  'vp_head_director',
  'manager',
  'individual',
  'unknown',
] as const;
export type RoleBucket = (typeof ROLE_BUCKETS)[number];

/**
 * Maps a free-text job title (`leads.title`) to one of the 6 role buckets.
 * Evaluated in seniority order so "Founder & CEO" -> founder_owner and
 * "VP of Engineering" -> vp_head_director.
 */
export function roleBucket(title: string | null | undefined): RoleBucket {
  const raw = (title ?? '').trim().toLowerCase();
  if (!raw) return 'unknown';

  // 1. Founder / Co-founder / Owner / Partner / Principal
  if (/\b(co-?founder|founder|owner|proprietor|managing partner)\b/.test(raw)) {
    return 'founder_owner';
  }

  // 2. C-level executives (CEO, CTO, COO, CMO, CFO, CRO, CPO, CISO, Chief ...)
  if (
    /\b(c[efimosrtpx]o|ciso|chief\s+[a-z]+(\s+officer)?|president|managing director)\b/.test(
      raw,
    )
  ) {
    return 'c_level';
  }

  // 3. VP / Head / Director
  if (/\b(svp|evp|avp|vp|vice\s+president|head\s+of|director)\b/.test(raw)) {
    return 'vp_head_director';
  }

  // 4. Manager / Team Lead
  if (/\b(manager|mgr|team\s+lead|tech\s+lead|group\s+lead|lead)\b/.test(raw)) {
    return 'manager';
  }

  // 5. Any other non-empty title is an individual contributor
  return 'individual';
}

export interface SnapshotTrigger {
  type: string;
  quote?: string;
  url?: string;
  observed_at?: string | null;
}

export interface EnrollmentSnapshot {
  company_key: string | null;
  city: string;
  region: string;
  country: string;
  timezone: string;
  industry: string;
  size_band: string;
  triggers: SnapshotTrigger[];
  primary_trigger: string;
  mail_provider: string;
  role_bucket: RoleBucket;
  stars: number | null;
  fit_score: number | null;
  prospect_id: string | null;
  discovery_run_id: string | null;
  preference_id: string | null;
  preference_revision: number | null;
  source: string;
  offer_id: string | null;
  snapshot_version: 1;
}

export interface SnapshotLeadInput {
  email?: string | null;
  title?: string | null;
  source?: string | null;
  custom?: Record<string, unknown> | null;
  company_key?: string | null;
  city?: string | null;
  region?: string | null;
  country?: string | null;
  timezone?: string | null;
  mail_provider?: string | null;
  prospect_id?: string | null;
  discovery_run_id?: string | null;
  prospect_city?: string | null;
  prospect_region?: string | null;
  prospect_country?: string | null;
  prospect_timezone?: string | null;
  prospect_industry?: string | null;
  prospect_size_band?: string | null;
  prospect_triggers?: unknown;
  prospect_mail_provider?: string | null;
  prospect_company_key?: string | null;
  prospect_stars?: number | null;
  prospect_fit_score?: number | null;
  offer_id?: string | null;
  preference_id?: string | null;
  preference_revision?: number | null;
}

const cleanStr = (v: unknown): string | null =>
  typeof v === 'string' && v.trim() ? v.trim() : null;

const cleanNum = (v: unknown): number | null => {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  return null;
};

export function buildEnrollmentSnapshot(
  input: SnapshotLeadInput,
): EnrollmentSnapshot {
  const custom = input.custom ?? {};
  const derivedKey =
    cleanStr(input.company_key) ??
    cleanStr(input.prospect_company_key) ??
    companyKey(input.email, leadWebsite(custom));

  const city =
    cleanStr(input.city) ??
    cleanStr(input.prospect_city) ??
    cleanStr(custom.city) ??
    'unknown';
  const region =
    cleanStr(input.region) ??
    cleanStr(input.prospect_region) ??
    cleanStr(custom.region) ??
    cleanStr(custom.state) ??
    'unknown';
  const country =
    cleanStr(input.country) ??
    cleanStr(input.prospect_country) ??
    cleanStr(custom.country) ??
    'unknown';
  const timezone =
    cleanStr(input.timezone) ?? cleanStr(input.prospect_timezone) ?? 'unknown';
  const industry =
    cleanStr(input.prospect_industry) ?? cleanStr(custom.industry) ?? 'unknown';
  const sizeBand =
    cleanStr(input.prospect_size_band) ??
    cleanStr(custom.size_band) ??
    'unknown';
  const mailProvider =
    cleanStr(input.mail_provider) ??
    cleanStr(input.prospect_mail_provider) ??
    'unknown';

  const rawTriggers = Array.isArray(input.prospect_triggers)
    ? input.prospect_triggers
    : [];
  const triggers: SnapshotTrigger[] = rawTriggers
    .filter(
      (t): t is Record<string, unknown> =>
        !!t &&
        typeof t === 'object' &&
        typeof (t as { type?: unknown }).type === 'string',
    )
    .map((t) => ({
      type: String(t.type),
      ...(typeof t.quote === 'string' ? { quote: t.quote } : {}),
      ...(typeof t.url === 'string' ? { url: t.url } : {}),
      observed_at: typeof t.observed_at === 'string' ? t.observed_at : null,
    }));

  const primaryTrigger = triggers[0]?.type ?? 'unknown';
  const stars = cleanNum(input.prospect_stars) ?? cleanNum(custom.expellyStars);
  const fitScore =
    cleanNum(input.prospect_fit_score) ?? cleanNum(custom.expellyFitScore);

  return {
    company_key: derivedKey,
    city,
    region,
    country,
    timezone,
    industry,
    size_band: sizeBand,
    triggers,
    primary_trigger: primaryTrigger,
    mail_provider: mailProvider,
    role_bucket: roleBucket(input.title),
    stars,
    fit_score: fitScore,
    prospect_id: cleanStr(input.prospect_id),
    discovery_run_id: cleanStr(input.discovery_run_id),
    preference_id: cleanStr(input.preference_id),
    preference_revision: cleanNum(input.preference_revision),
    source: cleanStr(input.source) ?? 'unknown',
    offer_id: cleanStr(input.offer_id),
    snapshot_version: 1,
  };
}
