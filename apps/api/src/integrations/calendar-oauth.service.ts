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
import { CALENDAR_SCOPE } from './calendar-logic';
import { IntegrationsService } from './integrations.service';

const SCOPES = ['openid', 'email', CALENDAR_SCOPE];

interface CalendarState {
  type: 'calendar-connect';
  sub: string;
  orgId: string;
  /** sha256 of the browser-binding cookie (OAuth CSRF guard). */
  nh: string;
}

/**
 * "Connect Google Calendar" (T16): read-only access to event times and
 * attendee emails, so a meeting with one of our leads becomes a verified
 * booked call. Same OAuth client and callback URL as Gmail and Sheets; the
 * signed state's type routes the callback here. Optional and separate: the
 * calendar scope is never added to the Gmail or Sheets connect screens.
 */
@Injectable()
export class CalendarOAuthService {
  private readonly log = new Logger(CalendarOAuthService.name);
  /** Swappable in tests. */
  fetchFn: FetchLike = (input: string | URL | Request, init?: RequestInit) =>
    fetch(input, init);

  constructor(
    private readonly config: ConfigService,
    private readonly jwt: JwtService,
    private readonly memberships: MembershipCache,
    private readonly integrations: IntegrationsService,
  ) {}

  async connectUrl(user: AuthUser, nonceHash: string) {
    if (!googleConfigured(this.config)) {
      throw new ServiceUnavailableException(
        'Google Calendar is not enabled on this server yet (Google OAuth credentials missing).',
      );
    }
    const state: CalendarState = {
      type: 'calendar-connect',
      sub: user.userId,
      orgId: user.orgId,
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
    const back = (params: Record<string, string>) =>
      `${webUrl(this.config)}/settings?${new URLSearchParams(params).toString()}`;
    try {
      const state = await this.verifyState(q.state);
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
          'Only workspace admins and managers can connect Google Calendar.',
        );
      }
      const tokens = await exchangeCode(this.config, this.fetchFn, q.code);
      if (!(tokens.scope ?? '').split(' ').includes(CALENDAR_SCOPE)) {
        throw new ConnectError(
          'Permission to see your calendar events was not granted. Reconnect and allow it on the Google screen.',
        );
      }
      if (!tokens.refresh_token) {
        throw new ConnectError(
          'Google did not grant offline access. Remove Expelly under your Google Account → Security → Third-party access, then reconnect.',
        );
      }
      const email = emailFromIdToken(tokens.id_token);
      const { reconnected } = await this.integrations.saveCalendar(
        state.orgId,
        state.sub,
        {
          email,
          refreshToken: tokens.refresh_token,
          scope: tokens.scope ?? '',
        },
      );
      return back({
        calendar: reconnected ? 'reconnected' : 'connected',
        email,
      });
    } catch (err) {
      if (err instanceof ConnectError || err instanceof HttpException) {
        return back({ calendar: 'error', reason: err.message });
      }
      this.log.error(
        `Calendar connect failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      return back({
        calendar: 'error',
        reason: 'Connecting Google Calendar failed. Try again in a minute.',
      });
    }
  }

  private async verifyState(raw?: string): Promise<CalendarState> {
    try {
      const s = await this.jwt.verifyAsync<CalendarState>(raw ?? '');
      if (s.type !== 'calendar-connect' || !s.sub || !s.orgId) {
        throw new Error();
      }
      return s;
    } catch {
      throw new ConnectError(
        'This connect link has expired. Start again from Settings.',
      );
    }
  }
}
