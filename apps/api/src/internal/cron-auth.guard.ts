import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { timingSafeEqual } from 'crypto';
import { OAuth2Client } from 'google-auth-library';
import type { Request } from 'express';

/**
 * Who may call /internal/cron/* (Learning Loop T13).
 *
 * Production: only Cloud Scheduler, which sends a Google-signed ID token. We
 * verify the signature, that the token was made FOR this API (audience), and
 * that it belongs to the scheduler's service account (email). Nothing else
 * gets in: the normal user login does not open these routes.
 *
 * Local development only: an `X-Cron-Secret` header equal to CRON_DEV_SECRET,
 * and only when NODE_ENV=development (never in production or in tests).
 */
export const CRON_TOKEN_VERIFIER = Symbol('CRON_TOKEN_VERIFIER');

export interface VerifiedToken {
  email: string | null;
  emailVerified: boolean;
}

/** Test seam: the real one asks Google's public keys, tests give canned answers. */
export interface CronTokenVerifier {
  verify(idToken: string, audiences: string[]): Promise<VerifiedToken | null>;
}

@Injectable()
export class GoogleCronTokenVerifier implements CronTokenVerifier {
  private readonly client = new OAuth2Client();

  async verify(
    idToken: string,
    audiences: string[],
  ): Promise<VerifiedToken | null> {
    try {
      const ticket = await this.client.verifyIdToken({
        idToken,
        audience: audiences,
      });
      const p = ticket.getPayload();
      return p
        ? { email: p.email ?? null, emailVerified: p.email_verified === true }
        : null;
    } catch {
      return null; // bad signature, expired, wrong audience...
    }
  }
}

const same = (a: string, b: string) => {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

@Injectable()
export class CronAuthGuard implements CanActivate {
  private readonly logger = new Logger(CronAuthGuard.name);

  constructor(
    private readonly config: ConfigService,
    @Inject(CRON_TOKEN_VERIFIER) private readonly verifier: CronTokenVerifier,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<Request>();

    // dev convenience: never outside NODE_ENV=development
    const devSecret = this.config.get<string>('CRON_DEV_SECRET')?.trim();
    const sent = req.headers['x-cron-secret'];
    if (
      process.env.NODE_ENV === 'development' &&
      devSecret &&
      typeof sent === 'string' &&
      same(sent, devSecret)
    ) {
      return true;
    }

    const header = req.headers.authorization;
    const token =
      typeof header === 'string' && header.startsWith('Bearer ')
        ? header.slice(7).trim()
        : '';
    const audiences = (this.config.get<string>('CRON_AUDIENCE') ?? '')
      .split(',')
      .map((a) => a.trim())
      .filter(Boolean);
    const sa = this.config.get<string>('CRON_SA_EMAIL')?.trim().toLowerCase();
    if (!token || audiences.length === 0 || !sa) {
      throw new UnauthorizedException();
    }
    const verified = await this.verifier.verify(token, audiences);
    if (
      !verified ||
      !verified.emailVerified ||
      verified.email?.toLowerCase() !== sa
    ) {
      this.logger.warn(
        'cron call refused: token is not the scheduler service account',
      );
      throw new UnauthorizedException();
    }
    return true;
  }
}
