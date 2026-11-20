import {
  INDUSTRIES,
  SIZE_BANDS,
  TRIGGER_TYPES,
  type Industry,
  type SizeBand,
  type Trigger,
  type TriggerType,
} from '../leads/attributes';

/**
 * Discover attributes (Learning Loop T01). The model proposes; this module
 * decides what is kept, exactly like evidence: a value the fetched pages don't
 * back up is dropped and stays explicit "unknown". The timezone is never taken
 * from the model, it is derived here from country + city.
 */

const squash = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Does `needle` appear as a whole word/phrase in already-squashed `hay`? */
const hasWord = (hay: string, needle: string) =>
  needle.length >= 2 &&
  new RegExp(`(?<![a-z0-9])${esc(needle)}(?![a-z0-9])`).test(hay);

// ── countries ──────────────────────────────────────────────────────────────

/** ISO-2 code -> names a website might print (lowercase, no accents). */
const COUNTRY_NAMES: Record<string, string[]> = {
  IN: ['india'],
  US: ['united states', 'united states of america', 'usa', 'u.s.a.', 'u.s.'],
  GB: ['united kingdom', 'uk', 'u.k.', 'england', 'scotland', 'wales'],
  CA: ['canada'],
  AU: ['australia'],
  NZ: ['new zealand'],
  IE: ['ireland'],
  DE: ['germany', 'deutschland'],
  FR: ['france'],
  ES: ['spain', 'espana'],
  IT: ['italy', 'italia'],
  NL: ['netherlands', 'the netherlands', 'nederland', 'holland'],
  BE: ['belgium'],
  CH: ['switzerland', 'schweiz', 'suisse'],
  AT: ['austria', 'osterreich'],
  SE: ['sweden', 'sverige'],
  NO: ['norway', 'norge'],
  DK: ['denmark', 'danmark'],
  FI: ['finland', 'suomi'],
  PL: ['poland', 'polska'],
  PT: ['portugal'],
  TR: ['turkey', 'turkiye'],
  AE: ['united arab emirates', 'uae', 'u.a.e.'],
  SA: ['saudi arabia'],
  IL: ['israel'],
  EG: ['egypt'],
  ZA: ['south africa'],
  NG: ['nigeria'],
  KE: ['kenya'],
  SG: ['singapore'],
  MY: ['malaysia'],
  ID: ['indonesia'],
  PH: ['philippines'],
  TH: ['thailand'],
  VN: ['vietnam', 'viet nam'],
  JP: ['japan'],
  KR: ['south korea', 'korea'],
  CN: ['china'],
  HK: ['hong kong'],
  PK: ['pakistan'],
  BD: ['bangladesh'],
  LK: ['sri lanka'],
  BR: ['brazil', 'brasil'],
  MX: ['mexico'],
  AR: ['argentina'],
  CL: ['chile'],
  CO: ['colombia'],
  PE: ['peru'],
  RU: ['russia'],
};

const NAME_TO_CODE = new Map<string, string>();
for (const [code, names] of Object.entries(COUNTRY_NAMES)) {
  for (const n of names) NAME_TO_CODE.set(n, code);
}

/** "India" / "IN" / "U.S.A." -> "IN" / "IN" / "US"; unknown -> null. */
export function countryCode(raw: string): string | null {
  const s = squash(raw);
  if (!s) return null;
  const byName = NAME_TO_CODE.get(s);
  if (byName) return byName;
  const up = raw.trim().toUpperCase();
  return COUNTRY_NAMES[up] ? up : null;
}

// ── timezone (derived in code, never trusted from the model) ───────────────

/** Countries with one civil timezone for our purposes. */
const SINGLE_ZONE: Record<string, string> = {
  IN: 'Asia/Kolkata',
  GB: 'Europe/London',
  IE: 'Europe/Dublin',
  DE: 'Europe/Berlin',
  FR: 'Europe/Paris',
  ES: 'Europe/Madrid',
  IT: 'Europe/Rome',
  NL: 'Europe/Amsterdam',
  BE: 'Europe/Brussels',
  CH: 'Europe/Zurich',
  AT: 'Europe/Vienna',
  SE: 'Europe/Stockholm',
  NO: 'Europe/Oslo',
  DK: 'Europe/Copenhagen',
  FI: 'Europe/Helsinki',
  PL: 'Europe/Warsaw',
  PT: 'Europe/Lisbon',
  TR: 'Europe/Istanbul',
  AE: 'Asia/Dubai',
  SA: 'Asia/Riyadh',
  IL: 'Asia/Jerusalem',
  EG: 'Africa/Cairo',
  ZA: 'Africa/Johannesburg',
  NG: 'Africa/Lagos',
  KE: 'Africa/Nairobi',
  SG: 'Asia/Singapore',
  MY: 'Asia/Kuala_Lumpur',
  PH: 'Asia/Manila',
  TH: 'Asia/Bangkok',
  VN: 'Asia/Ho_Chi_Minh',
  JP: 'Asia/Tokyo',
  KR: 'Asia/Seoul',
  CN: 'Asia/Shanghai',
  HK: 'Asia/Hong_Kong',
  PK: 'Asia/Karachi',
  BD: 'Asia/Dhaka',
  LK: 'Asia/Colombo',
  NZ: 'Pacific/Auckland',
  AR: 'America/Argentina/Buenos_Aires',
  CL: 'America/Santiago',
  CO: 'America/Bogota',
  PE: 'America/Lima',
};

/** Multi-zone countries: zone -> its main cities. A city not listed = null. */
const CITY_ZONE_LISTS: Record<string, Record<string, string[]>> = {
  US: {
    'America/New_York': [
      'new york',
      'new york city',
      'nyc',
      'brooklyn',
      'boston',
      'philadelphia',
      'pittsburgh',
      'atlanta',
      'miami',
      'orlando',
      'tampa',
      'charlotte',
      'washington',
      'washington dc',
      'baltimore',
      'detroit',
      'cleveland',
      'raleigh',
      'jacksonville',
      'buffalo',
      'columbus',
      'cincinnati',
    ],
    'America/Chicago': [
      'chicago',
      'dallas',
      'houston',
      'austin',
      'san antonio',
      'minneapolis',
      'st louis',
      'saint louis',
      'kansas city',
      'nashville',
      'milwaukee',
      'new orleans',
      'oklahoma city',
      'memphis',
      'omaha',
    ],
    'America/Denver': ['denver', 'salt lake city', 'boulder', 'albuquerque'],
    'America/Phoenix': ['phoenix', 'tucson', 'scottsdale'],
    'America/Los_Angeles': [
      'los angeles',
      'san francisco',
      'san diego',
      'san jose',
      'seattle',
      'portland',
      'las vegas',
      'sacramento',
      'oakland',
      'palo alto',
      'mountain view',
      'irvine',
    ],
    'America/Anchorage': ['anchorage'],
    'Pacific/Honolulu': ['honolulu'],
  },
  CA: {
    'America/Toronto': [
      'toronto',
      'ottawa',
      'montreal',
      'mississauga',
      'quebec city',
    ],
    'America/Vancouver': ['vancouver', 'victoria', 'burnaby'],
    'America/Edmonton': ['calgary', 'edmonton'],
    'America/Winnipeg': ['winnipeg'],
    'America/Halifax': ['halifax'],
  },
  AU: {
    'Australia/Sydney': ['sydney', 'canberra', 'newcastle'],
    'Australia/Melbourne': ['melbourne', 'geelong'],
    'Australia/Brisbane': ['brisbane', 'gold coast', 'cairns'],
    'Australia/Perth': ['perth'],
    'Australia/Adelaide': ['adelaide'],
    'Australia/Darwin': ['darwin'],
    'Australia/Hobart': ['hobart'],
  },
  BR: {
    'America/Sao_Paulo': [
      'sao paulo',
      'rio de janeiro',
      'brasilia',
      'belo horizonte',
      'curitiba',
      'porto alegre',
      'salvador',
      'recife',
      'fortaleza',
    ],
    'America/Manaus': ['manaus'],
  },
  RU: {
    'Europe/Moscow': ['moscow', 'saint petersburg', 'st petersburg'],
    'Asia/Yekaterinburg': ['yekaterinburg'],
    'Asia/Novosibirsk': ['novosibirsk'],
    'Asia/Vladivostok': ['vladivostok'],
  },
  MX: {
    'America/Mexico_City': [
      'mexico city',
      'guadalajara',
      'monterrey',
      'puebla',
    ],
    'America/Tijuana': ['tijuana'],
    'America/Cancun': ['cancun'],
  },
  ID: {
    'Asia/Jakarta': ['jakarta', 'bandung', 'surabaya', 'medan', 'semarang'],
    'Asia/Makassar': ['denpasar', 'bali', 'makassar'],
    'Asia/Jayapura': ['jayapura'],
  },
};

const CITY_ZONES: Record<string, Map<string, string>> = {};
for (const [code, zones] of Object.entries(CITY_ZONE_LISTS)) {
  const m = new Map<string, string>();
  for (const [zone, names] of Object.entries(zones)) {
    for (const n of names) m.set(n, zone);
  }
  CITY_ZONES[code] = m;
}

/** True when the runtime knows this IANA zone. */
export function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat(undefined, { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/**
 * IANA zone from a country and (for multi-zone countries) a city, or null
 * when ambiguous. Always validated before it is returned.
 */
export function timezoneFor(
  country: string | null,
  city: string | null,
): string | null {
  if (!country) return null;
  const code = countryCode(country);
  if (!code) return null;
  let zone: string | undefined = SINGLE_ZONE[code];
  if (!zone && CITY_ZONES[code]) {
    zone = city
      ? CITY_ZONES[code].get(squash(city).replace(/\./g, ''))
      : undefined;
  }
  return zone && isValidTimeZone(zone) ? zone : null;
}

// ── location: kept only if a fetched page says it ──────────────────────────

export interface Location {
  city: string | null;
  region: string | null;
  country: string | null; // ISO-2 when recognised, else the verified raw text
  timezone: string | null;
}

const clip = (v: unknown, max: number): string | null =>
  typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null;

export function verifyLocation(
  proposed: { city?: unknown; region?: unknown; country?: unknown },
  pages: { url: string; text: string }[],
): Location {
  const text = squash(pages.map((p) => p.text).join(' \n '));
  const onPage = (v: string | null) =>
    v && hasWord(text, squash(v)) ? v : null;
  const city = onPage(clip(proposed.city, 80));
  const region = onPage(clip(proposed.region, 80));
  const rawCountry = clip(proposed.country, 80);
  let country: string | null = null;
  if (rawCountry) {
    const code = countryCode(rawCountry);
    if (code) {
      // any spelling of the country on a page backs it up (2-letter
      // abbreviations like "uk" are too loose to count as evidence alone,
      // so require a name of 3+ characters)
      const names = COUNTRY_NAMES[code].filter((n) => n.length >= 3);
      country = names.some((n) => hasWord(text, n)) ? code : null;
    } else {
      country = onPage(rawCountry);
    }
  }
  return { city, region, country, timezone: timezoneFor(country, city) };
}

// ── triggers: quote must literally be on the page it cites ─────────────────

export function verifyTriggers(
  proposed: unknown,
  pages: { url: string; text: string }[],
): Trigger[] {
  if (!Array.isArray(proposed)) return [];
  const byUrl = new Map(pages.map((p) => [p.url, squash(p.text)]));
  const all = pages.map((p) => ({ url: p.url, text: squash(p.text) }));
  const out: Trigger[] = [];
  for (const item of proposed) {
    const { type, quote, url } = (item ?? {}) as Record<string, unknown>;
    if (typeof type !== 'string' || typeof quote !== 'string') continue;
    if (!(TRIGGER_TYPES as readonly string[]).includes(type)) continue;
    const q = squash(quote);
    if (q.length < 12 || q.length > 300) continue;
    const cited = typeof url === 'string' ? byUrl.get(url) : undefined;
    const source = cited?.includes(q)
      ? (url as string)
      : (all.find((p) => p.text.includes(q))?.url ?? null);
    if (!source) continue;
    if (out.some((t) => t.type === type && squash(t.quote) === q)) continue;
    out.push({
      type: type as TriggerType,
      quote: quote.trim().replace(/\s+/g, ' ').slice(0, 300),
      url: source,
      observed_at: null,
    });
    if (out.length >= 4) break;
  }
  return out;
}

// ── inferred fields: validated against the fixed lists ─────────────────────

export function cleanIndustry(v: unknown): Industry {
  const s = typeof v === 'string' ? v.trim().toLowerCase() : '';
  return (INDUSTRIES as readonly string[]).includes(s)
    ? (s as Industry)
    : 'unknown';
}

export function cleanSizeBand(v: unknown): SizeBand {
  const s = typeof v === 'string' ? v.trim() : '';
  return (SIZE_BANDS as readonly string[]).includes(s)
    ? (s as SizeBand)
    : 'unknown';
}
