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
import {
  assertSameBrowser,
  buildAuthUrl,
  ConnectError,
  emailFromIdToken,
  exchangeCode,
  googleConfigured,
  googleErrorText,
  webUrl,
} from '../google/google-oauth';
import type { FetchLike } from '../senders/providers/gmail.provider';
import { IntegrationsService } from './integrations.service';

export const SHEETS_SCOPE =
  'https://www.googleapis.com/auth/spreadsheets.readonly';
const SCOPES = ['openid', 'email', SHEETS_SCOPE];
/** Pages a connect flow may return to (no open redirects). */
const RETURN_PATHS = ['/leads', '/settings'] as const;
type ReturnPath = (typeof RETURN_PATHS)[number];

interface SheetsState {
  type: 'sheets-connect';
  sub: string;
  orgId: string;
  returnTo: ReturnPath;
  /** sha256 of the browser-binding cookie (OAuth CSRF guard). */
  nh: string;
}

/**
 * "Connect Google Sheets" (T2.8): read-only access to the workspace's sheets.
 * Same OAuth client and callback URL as Gmail; the signed state's type routes
 * the callback here.
 */
@Injectable()
export class SheetsOAuthService {
  private readonly log = new Logger(SheetsOAuthService.name);
  /** Swappable in tests. */
  fetchFn: FetchLike = (input: string | URL | Request, init?: RequestInit) =>
    fetch(input, init);

  constructor(
    private readonly config: ConfigService,
    private readonly jwt: JwtService,
    private readonly memberships: MembershipCache,
    private readonly integrations: IntegrationsService,
  ) {}

  async connectUrl(
    user: AuthUser,
    returnTo: string | undefined,
    nonceHash: string,
  ) {
    if (!googleConfigured(this.config)) {
      throw new ServiceUnavailableException(
        'Google Sheets is not enabled on this server yet (Google OAuth credentials missing).',
      );
    }
    const state: SheetsState = {
      type: 'sheets-connect',
      sub: user.userId,
      orgId: user.orgId,
      returnTo: RETURN_PATHS.includes(returnTo as ReturnPath)
        ? (returnTo as ReturnPath)
        : '/settings',
      nh: nonceHash,
    };
    const signed = await this.jwt.signAsync(state, { expiresIn: '10m' });
    return { url: buildAuthUrl(this.config, SCOPES, signed) };
  }

  async handleCallback(
    q: { code?: string; state?: string; error?: string },
    /** Value of the browser-binding cookie on this request. */
    browserNonce?: string | null,
  ): Promise<string> {
    let returnTo: ReturnPath = '/settings';
    const back = (params: Record<string, string>) =>
      `${webUrl(this.config)}${returnTo}?${new URLSearchParams(params).toString()}`;
    try {
      const state = await this.verifyState(q.state);
      returnTo = state.returnTo;
      assertSameBrowser(browserNonce, state.nh);
      if (q.error) throw new ConnectError(googleErrorText(q.error));
      if (!q.code) {
        throw new ConnectError(
          'The Google response was incomplete. Try again.',
        );
      }
      const role = await this.memberships.role(state.sub, state.orgId);
      if (role !== 'admin' && role !== 'manager') {
        throw new ConnectError(
          'Only workspace admins and managers can connect Google Sheets.',
        );
      }
      const tokens = await exchangeCode(this.config, this.fetchFn, q.code);
      if (!(tokens.scope ?? '').split(' ').includes(SHEETS_SCOPE)) {
        throw new ConnectError(
          'Permission to see your spreadsheets was not granted. Reconnect and allow it on the Google screen.',
        );
      }
      if (!tokens.refresh_token) {
        throw new ConnectError(
          'Google did not grant offline access. Remove SuperSaaS under your Google Account → Security → Third-party access, then reconnect.',
        );
      }
      const email = emailFromIdToken(tokens.id_token);
      const { reconnected } = await this.integrations.saveSheets(
        state.orgId,
        state.sub,
        {
          email,
          refreshToken: tokens.refresh_token,
          scope: tokens.scope ?? '',
        },
      );
      return back({ sheets: reconnected ? 'reconnected' : 'connected', email });
    } catch (err) {
      if (err instanceof ConnectError || err instanceof HttpException) {
        return back({ sheets: 'error', reason: err.message });
      }
      this.log.error(
        `Sheets connect failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      return back({
        sheets: 'error',
        reason: 'Connecting Google Sheets failed. Try again in a minute.',
      });
    }
  }

  private async verifyState(raw?: string): Promise<SheetsState> {
    try {
      const s = await this.jwt.verifyAsync<SheetsState>(raw ?? '');
      if (s.type !== 'sheets-connect' || !s.sub || !s.orgId) throw new Error();
      return s;
    } catch {
      throw new ConnectError(
        'This connect link has expired. Start again from Settings.',
      );
    }
  }
}
