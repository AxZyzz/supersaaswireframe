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
  buildAuthUrl,
  ConnectError,
  emailFromIdToken,
  exchangeCode,
  googleConfigured,
  googleErrorText,
  webUrl,
} from '../google/google-oauth';
import { FetchLike } from './providers/gmail.provider';
import { SendersService } from './senders.service';

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

  isConfigured() {
    return googleConfigured(this.config);
  }

  async connectUrl(user: AuthUser, fromName?: string) {
    if (!this.isConfigured()) {
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
    return { url: buildAuthUrl(this.config, SCOPES, state) };
  }

  /** Handles Google's redirect; returns where to send the browser next. */
  async handleCallback(q: {
    code?: string;
    state?: string;
    error?: string;
  }): Promise<string> {
    const back = (params: Record<string, string>) =>
      `${webUrl(this.config)}/settings?${new URLSearchParams(params).toString()}`;

    try {
      if (q.error) {
        throw new ConnectError(googleErrorText(q.error));
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

      const tokens = await exchangeCode(this.config, this.fetchFn, q.code);
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
      const email = emailFromIdToken(tokens.id_token);

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
}
