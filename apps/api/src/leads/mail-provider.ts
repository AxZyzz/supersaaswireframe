import { promises as dns } from 'dns';
import type { MailProvider } from './attributes';

/**
 * Which mailbox provider a domain uses, from its MX records (Learning Loop
 * T01). Used as a Discover/lead factor ("Google Workspace vs Microsoft 365").
 *
 * The PRIMARY mail server decides (lowest MX priority): a domain behind a
 * filtering gateway (Mimecast, Proofpoint, ...) is "other" even if mail is
 * forwarded to Google behind it.
 */

export interface MxRecord {
  exchange: string;
  priority: number;
}

const host = (h: string) => h.toLowerCase().replace(/\.$/, '');

export function providerOfHost(exchange: string): MailProvider {
  const h = host(exchange);
  if (/(^|\.)(google|googlemail)\.com$/.test(h)) return 'google';
  if (/(^|\.)outlook\.com$/.test(h)) return 'microsoft';
  if (/(^|\.)zoho\.[a-z.]+$/.test(h)) return 'zoho';
  return 'other';
}

/** MX answer -> provider. null / empty = the lookup gave nothing = unknown. */
export function mapMx(records: MxRecord[] | null | undefined): MailProvider {
  if (!records?.length) return 'unknown';
  const primary = [...records].sort((a, b) => a.priority - b.priority)[0];
  return providerOfHost(primary.exchange);
}

export interface MailProviderCache {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlSeconds: number): Promise<void>;
}

/** Process-local cache, for tests and as a fallback when Redis is down. */
export class MemoryMailProviderCache implements MailProviderCache {
  private readonly m = new Map<string, { v: string; exp: number }>();
  get(key: string) {
    const hit = this.m.get(key);
    if (!hit || hit.exp < Date.now()) return Promise.resolve(null);
    return Promise.resolve(hit.v);
  }
  set(key: string, value: string, ttlSeconds: number) {
    this.m.set(key, { v: value, exp: Date.now() + ttlSeconds * 1000 });
    return Promise.resolve();
  }
}

/** Good answers are cached a week; a failed lookup only an hour, so a DNS
 *  blip can't mislabel a domain for days. */
export const TTL_OK_SECONDS = 7 * 24 * 3600;
export const TTL_FAILED_SECONDS = 3600;

export class MailProviderResolver {
  constructor(
    private readonly cache: MailProviderCache,
    private readonly resolveMx: (domain: string) => Promise<MxRecord[]> = (d) =>
      dns.resolveMx(d),
  ) {}

  /** One DNS lookup per domain per TTL, however many leads share it. */
  async lookup(domain: string): Promise<MailProvider> {
    const d = domain.trim().toLowerCase();
    if (!d) return 'unknown';
    const key = `mailprov:v1:${d}`;
    try {
      const hit = await this.cache.get(key);
      if (hit) return hit as MailProvider;
    } catch {
      /* cache down: fall through to DNS */
    }
    let provider: MailProvider;
    let ttl = TTL_OK_SECONDS;
    try {
      provider = mapMx(await this.resolveMx(d));
    } catch {
      provider = 'unknown';
    }
    if (provider === 'unknown') ttl = TTL_FAILED_SECONDS;
    try {
      await this.cache.set(key, provider, ttl);
    } catch {
      /* best effort */
    }
    return provider;
  }
}
