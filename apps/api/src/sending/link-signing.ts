import { createHash, createHmac, timingSafeEqual } from 'crypto';

/**
 * Click-tracking links carry an HMAC of (trackingId, destination) so the
 * redirect at GET /t/c/:id only follows links we actually put in an email.
 * Without it the endpoint is an open redirect: anyone could craft
 * https://<our domain>/t/c/<uuid>?u=https://phish.example and borrow our
 * domain's reputation. The key is derived from APP_ENCRYPTION_KEY (no new
 * secret to manage); 128-bit tags.
 */
export function clickKey(encryptionKey: string): Buffer {
  return createHash('sha256')
    .update(`supersaas:click-links:v1:${encryptionKey}`)
    .digest();
}

export function signClick(
  key: Buffer,
  trackingId: string,
  url: string,
): string {
  return createHmac('sha256', key)
    .update(`${trackingId}\n${url}`)
    .digest('base64url')
    .slice(0, 22);
}

export function verifyClick(
  key: Buffer,
  trackingId: string,
  url: string,
  sig: string | undefined,
): boolean {
  if (!sig) return false;
  const want = Buffer.from(signClick(key, trackingId, url));
  const got = Buffer.from(sig);
  return got.length === want.length && timingSafeEqual(got, want);
}
