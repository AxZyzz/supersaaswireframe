import { createHash, randomUUID } from 'crypto';
import MailComposer from 'nodemailer/lib/mail-composer';
import {
  EmailMessage,
  EmailProvider,
  SendResult,
  VerifyResult,
} from './email-provider';

/** Decrypted Gmail sender config: the user's refresh token + our OAuth app. */
export interface GmailConfig {
  refreshToken: string;
  clientId: string;
  clientSecret: string;
}

export type FetchLike = typeof fetch;

export const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GMAIL_SEND_URL =
  'https://gmail.googleapis.com/gmail/v1/users/me/messages/send';

/**
 * Google said the refresh token is no longer valid (user revoked access, or
 * the OAuth app is still in "Testing" mode, where tokens expire after 7 days).
 * Only a reconnect fixes it, so callers mark the sender unverified.
 */
export class GmailAuthError extends Error {}

// Access tokens live ~1h. Providers are built per send, so cache across
// instances, keyed by a hash of the refresh token (never the token itself).
const tokenCache = new Map<string, { token: string; exp: number }>();
const cacheKey = (refreshToken: string) =>
  createHash('sha256').update(refreshToken).digest('hex');

/** Test hook. */
export function clearGmailTokenCache() {
  tokenCache.clear();
}

interface TokenResponse {
  access_token?: string;
  expires_in?: number;
  error?: string;
  error_description?: string;
}

/**
 * Access token for a Google refresh token, cached ~1h. Shared by Gmail
 * sending and Sheets sync; `revoked` is the message for invalid_grant.
 */
export async function googleAccessToken(
  cfg: GmailConfig,
  fetchFn: FetchLike,
  revoked = 'Google access for this Gmail account was revoked or has expired. Reconnect it.',
): Promise<string> {
  const key = cacheKey(cfg.refreshToken);
  const hit = tokenCache.get(key);
  if (hit && hit.exp > Date.now() + 60_000) return hit.token;

  const res = await fetchFn(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
      refresh_token: cfg.refreshToken,
      grant_type: 'refresh_token',
    }),
  });
  const body = (await res.json().catch(() => ({}))) as TokenResponse;
  if (!res.ok || !body.access_token) {
    if (body.error === 'invalid_grant') {
      throw new GmailAuthError(revoked);
    }
    throw new Error(
      `Google token refresh failed: ${body.error_description ?? body.error ?? `HTTP ${res.status}`}`,
    );
  }
  tokenCache.set(key, {
    token: body.access_token,
    exp: Date.now() + (body.expires_in ?? 3600) * 1000,
  });
  return body.access_token;
}

/**
 * Sends through the Gmail API as the connected Google account (T3.3). Needs
 * only the `gmail.send` scope: we build the MIME message ourselves (same
 * composer nodemailer uses for SMTP) and post it raw.
 */
export class GmailProvider implements EmailProvider {
  readonly provider = 'gmail';

  constructor(
    private readonly cfg: GmailConfig,
    private readonly from: string,
    private readonly fromName?: string,
    private readonly replyTo?: string | null,
    private readonly fetchFn: FetchLike = fetch,
  ) {}

  async verify(): Promise<VerifyResult> {
    try {
      await googleAccessToken(this.cfg, this.fetchFn);
      return { ok: true, detail: `Connected to Gmail as ${this.from}` };
    } catch (err) {
      return {
        ok: false,
        detail: err instanceof Error ? err.message : 'Gmail check failed',
      };
    }
  }

  async send(msg: EmailMessage): Promise<SendResult> {
    // Our own Message-ID so reply threading works the same as SMTP.
    const domain = this.from.split('@')[1] ?? 'gmail.com';
    const messageId = `<${randomUUID()}@${domain}>`;
    const raw = await new MailComposer({
      from: this.fromName
        ? { name: this.fromName, address: this.from }
        : this.from,
      to: msg.to,
      subject: msg.subject,
      html: msg.html,
      text: msg.text,
      replyTo: this.replyTo ?? undefined,
      headers: msg.headers,
      messageId,
    })
      .compile()
      .build();

    const token = await googleAccessToken(this.cfg, this.fetchFn);
    const res = await this.fetchFn(GMAIL_SEND_URL, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ raw: raw.toString('base64url') }),
    });
    if (!res.ok) {
      if (res.status === 401)
        tokenCache.delete(cacheKey(this.cfg.refreshToken));
      const body = (await res.json().catch(() => ({}))) as {
        error?: { message?: string };
      };
      throw new Error(
        `Gmail send failed (HTTP ${res.status}): ${body.error?.message ?? 'unknown error'}`,
      );
    }
    return { messageId, provider: this.provider };
  }
}
