import {
  HttpException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { MembershipCache } from '../auth/membership-cache.service';
import type { AuthUser } from '../auth/types';
import { FetchLike, GOOGLE_TOKEN_URL } from './providers/gmail.provider';
import { SendersService } from './senders.service';

const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
export const GMAIL_SEND_SCOPE = 'https://www.googleapis.com/auth/gmail.send';
// openid + email: lets us read which address was connected from the ID token
// without asking for a Gmail read scope.
const SCOPES = ['openid', 'email', GMAIL_SEND_SCOPE];

interface ConnectState {
  type: 'gmail-connect';
  sub: string;
  orgId: string;
  fromName?: string;
}

interface GoogleTokenResponse {
  access_token?: string;
  refresh_token?: string;
  id_token?: string;
  scope?: string;
  error?: string;
  error_description?: string;
}

/** A problem worth showing the user on the settings page. */
class ConnectError extends Error {}

/**
 * "Connect Gmail" (T3.3). The signed-in user asks for a Google consent URL;
 * the `state` param is a 10-minute signed token naming their workspace, so the
 * public callback knows where the new sender belongs and can't be forged.
 */
@Injectable()
export class GmailOAuthService {
  private readonly log = new Logger(GmailOAuthService.name);
  /** Swappable in tests. */
  fetchFn: FetchLike = (input: string | URL | Request, init?: RequestInit) =>
    fetch(input, init);

  constructor(
    private readonly config: ConfigService,
    private readonly jwt: JwtService,
    private readonly senders: SendersService,
    private readonly memberships: MembershipCache,
  ) {}

  private creds() {
    const clientId = this.config.get<string>('GOOGLE_CLIENT_ID');
    const clientSecret = this.config.get<string>('GOOGLE_CLIENT_SECRET');
    const apiUrl = this.config.get<string>('API_URL', 'http://localhost:4000');
    const redirectUri =
      this.config.get<string>('GOOGLE_OAUTH_REDIRECT_URL') ||
      `${apiUrl.replace(/\/$/, '')}/auth/google/callback`;
    return { clientId, clientSecret, redirectUri };
  }

  isConfigured() {
    const { clientId, clientSecret } = this.creds();
    return !!clientId && !!clientSecret;
  }

  async connectUrl(user: AuthUser, fromName?: string) {
    const { clientId, redirectUri } = this.creds();
    if (!this.isConfigured() || !clientId) {
      throw new ServiceUnavailableException(
        'Gmail sending is not enabled on this server yet (Google OAuth credentials missing).',
      );
    }
    const payload: ConnectState = {
      type: 'gmail-connect',
      sub: user.userId,
      orgId: user.orgId,
      ...(fromName?.trim() ? { fromName: fromName.trim() } : {}),
    };
    const state = await this.jwt.signAsync(payload, { expiresIn: '10m' });
    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: SCOPES.join(' '),
      // offline + consent: always get a refresh token, even on reconnect.
      access_type: 'offline',
      prompt: 'consent',
      include_granted_scopes: 'true',
      state,
    });
    return { url: `${GOOGLE_AUTH_URL}?${params.toString()}` };
  }

  /** Handles Google's redirect; returns where to send the browser next. */
  async handleCallback(q: {
    code?: string;
    state?: string;
    error?: string;
  }): Promise<string> {
    const webUrl = this.config
      .get<string>('WEB_URL', 'http://localhost:3000')
      .replace(/\/$/, '');
    const back = (params: Record<string, string>) =>
      `${webUrl}/settings?${new URLSearchParams(params).toString()}`;

    try {
      if (q.error) {
        throw new ConnectError(
          q.error === 'access_denied'
            ? 'Google sign-in was cancelled.'
            : `Google returned an error: ${q.error}`,
        );
      }
      if (!q.code || !q.state) {
        throw new ConnectError(
          'The Google response was incomplete. Try again.',
        );
      }
      const state = await this.verifyState(q.state);

      // The link was minted for a manager/admin; re-check they still are.
      const role = await this.memberships.role(state.sub, state.orgId);
      if (role !== 'admin' && role !== 'manager') {
        throw new ConnectError(
          'Only workspace admins and managers can connect senders.',
        );
      }

      const tokens = await this.exchangeCode(q.code);
      const granted = (tokens.scope ?? '').split(' ');
      if (!granted.includes(GMAIL_SEND_SCOPE)) {
        throw new ConnectError(
          'Permission to send email was not granted. Reconnect and tick "Send email on your behalf" on the Google screen.',
        );
      }
      if (!tokens.refresh_token) {
        throw new ConnectError(
          'Google did not grant offline access. Remove SuperSaaS under your Google Account → Security → Third-party access, then reconnect.',
        );
      }
      const email = this.emailFromIdToken(tokens.id_token);

      const { reconnected } = await this.senders.connectGmail(state.orgId, {
        email,
        fromName: state.fromName ?? email.split('@')[0],
        refreshToken: tokens.refresh_token,
        scope: tokens.scope ?? '',
      });
      return back({
        gmail: reconnected ? 'reconnected' : 'connected',
        email,
      });
    } catch (err) {
      if (err instanceof ConnectError || err instanceof HttpException) {
        return back({ gmail: 'error', reason: err.message });
      }
      this.log.error(
        `Gmail connect failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      return back({
        gmail: 'error',
        reason: 'Connecting Gmail failed. Try again in a minute.',
      });
    }
  }

  private async verifyState(raw: string): Promise<ConnectState> {
    try {
      const s = await this.jwt.verifyAsync<ConnectState>(raw);
      if (s.type !== 'gmail-connect' || !s.sub || !s.orgId) throw new Error();
      return s;
    } catch {
      throw new ConnectError(
        'This connect link has expired. Start again from Settings.',
      );
    }
  }

  private async exchangeCode(code: string): Promise<GoogleTokenResponse> {
    const { clientId, clientSecret, redirectUri } = this.creds();
    const res = await this.fetchFn(GOOGLE_TOKEN_URL, {
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
    const body = (await res.json().catch(() => ({}))) as GoogleTokenResponse;
    if (!res.ok || !body.access_token) {
      throw new ConnectError(
        `Google rejected the sign-in (${body.error_description ?? body.error ?? `HTTP ${res.status}`}).`,
      );
    }
    return body;
  }

  // The ID token arrives straight from Google's token endpoint over TLS (not
  // via the browser), so reading its claims without re-verifying the
  // signature is safe here.
  private emailFromIdToken(idToken?: string): string {
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
}
