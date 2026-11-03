import { ConfigService } from '@nestjs/config';
import {
  FetchLike,
  GOOGLE_TOKEN_URL,
} from '../senders/providers/gmail.provider';

/**
 * Pieces shared by every "Connect with Google" flow (Gmail sending T3.3,
 * Sheets sync T2.8). They all use one OAuth client and one redirect URI
 * (GET /auth/google/callback); the signed `state` says which flow it was.
 */
export const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';

/** A problem worth showing the user on the page they return to. */
export class ConnectError extends Error {}

export interface GoogleTokens {
  access_token?: string;
  refresh_token?: string;
  id_token?: string;
  scope?: string;
  error?: string;
  error_description?: string;
}

export function googleCreds(config: ConfigService) {
  const clientId = config.get<string>('GOOGLE_CLIENT_ID');
  const clientSecret = config.get<string>('GOOGLE_CLIENT_SECRET');
  const apiUrl = config.get<string>('API_URL', 'http://localhost:4000');
  const redirectUri =
    config.get<string>('GOOGLE_OAUTH_REDIRECT_URL') ||
    `${apiUrl.replace(/\/$/, '')}/auth/google/callback`;
  return { clientId, clientSecret, redirectUri };
}

export const googleConfigured = (config: ConfigService) => {
  const { clientId, clientSecret } = googleCreds(config);
  return !!clientId && !!clientSecret;
};

export const webUrl = (config: ConfigService) =>
  config.get<string>('WEB_URL', 'http://localhost:3000').replace(/\/$/, '');

/** Consent URL; offline + consent so we always get a refresh token. */
export function buildAuthUrl(
  config: ConfigService,
  scopes: string[],
  state: string,
): string {
  const { clientId, redirectUri } = googleCreds(config);
  const params = new URLSearchParams({
    client_id: clientId ?? '',
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: scopes.join(' '),
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'true',
    state,
  });
  return `${GOOGLE_AUTH_URL}?${params.toString()}`;
}

export async function exchangeCode(
  config: ConfigService,
  fetchFn: FetchLike,
  code: string,
): Promise<GoogleTokens> {
  const { clientId, clientSecret, redirectUri } = googleCreds(config);
  const res = await fetchFn(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: clientId ?? '',
      client_secret: clientSecret ?? '',
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    }),
  });
  const body = (await res.json().catch(() => ({}))) as GoogleTokens;
  if (!res.ok || !body.access_token) {
    throw new ConnectError(
      `Google rejected the sign-in (${body.error_description ?? body.error ?? `HTTP ${res.status}`}).`,
    );
  }
  return body;
}

// The ID token arrives straight from Google's token endpoint over TLS (not
// via the browser), so reading its claims without re-verifying the signature
// is safe here.
export function emailFromIdToken(idToken?: string): string {
  try {
    const claims = JSON.parse(
      Buffer.from(idToken!.split('.')[1], 'base64url').toString('utf8'),
    ) as { email?: string; email_verified?: boolean };
    if (claims.email && claims.email_verified !== false) {
      return claims.email.toLowerCase();
    }
  } catch {
    // fall through
  }
  throw new ConnectError(
    'Google did not share the account email address. Try again.',
  );
}

/** Message for Google's ?error= on the callback. */
export const googleErrorText = (error: string) =>
  error === 'access_denied'
    ? 'Google sign-in was cancelled.'
    : `Google returned an error: ${error}`;

/** Which flow a callback belongs to, read from the (unverified) state. Each
 *  flow verifies the signature itself; this only picks the handler. */
export function stateType(raw?: string): string | null {
  try {
    const payload = JSON.parse(
      Buffer.from((raw ?? '').split('.')[1], 'base64url').toString('utf8'),
    ) as { type?: unknown };
    return typeof payload.type === 'string' ? payload.type : null;
  } catch {
    return null;
  }
}
