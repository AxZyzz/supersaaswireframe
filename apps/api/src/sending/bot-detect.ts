/**
 * Machine opens/clicks (T5.4). Corporate mail security gateways and link
 * scanners fetch every pixel and URL the moment a message lands, which would
 * otherwise show up as instant "opens" and "clicks" — inflating stats,
 * passing "if opened" step gates, and making leads look engaged.
 *
 * Deliberately conservative: Gmail's image proxy (GoogleImageProxy) only
 * fetches when a person opens the mail, so it counts as human. Apple Mail
 * Privacy Protection prefetches look like a normal browser and can't be told
 * apart reliably; those still count.
 */

/** Hits this soon after sending are delivery-time scans, not a person. */
export const PREFETCH_WINDOW_MS = 10_000;

const SCANNER_UA =
  /bot\b|crawler|spider|scanner|curl\/|wget\/|python-requests|python-urllib|go-http-client|java\/|okhttp|libwww|httpclient|headless|phantomjs|barracuda|mimecast|proofpoint|ironport|symantec|messagelabs|forcepoint|trend ?micro|sophos|fortinet|zscaler|bitdefender|safelinks|microsoft office protection|appengine-google/i;

export type BotReason = 'no_user_agent' | 'scanner_user_agent' | 'prefetch';

export function botReason(
  userAgent: string | undefined,
  sentAt: Date | null,
  now = Date.now(),
): BotReason | null {
  const ua = userAgent?.trim();
  if (!ua) return 'no_user_agent';
  if (/GoogleImageProxy/i.test(ua)) return null;
  if (SCANNER_UA.test(ua)) return 'scanner_user_agent';
  if (sentAt && now - sentAt.getTime() < PREFETCH_WINDOW_MS) return 'prefetch';
  return null;
}
