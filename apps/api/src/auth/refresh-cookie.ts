import {
  BadRequestException,
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import type { CookieOptions, Request, Response } from 'express';
import { map, Observable } from 'rxjs';

/**
 * Refresh tokens travel only in an httpOnly cookie, never in a response body,
 * so page scripts (and any XSS) can't read or persist the long-lived
 * credential. The short-lived access token stays in the body and lives in
 * the web app's memory.
 */
export const REFRESH_COOKIE = 'ss_rt';
const REFRESH_TTL_MS = 30 * 24 * 60 * 60 * 1000; // matches REFRESH_TTL_DAYS

export function refreshCookieOptions(): CookieOptions {
  const sameSite = (process.env.COOKIE_SAMESITE ?? 'lax') as
    'lax' | 'strict' | 'none';
  return {
    httpOnly: true,
    // SameSite=None is only honoured on Secure cookies.
    secure:
      process.env.NODE_ENV === 'production' ||
      process.env.COOKIE_SECURE === 'true' ||
      sameSite === 'none',
    sameSite,
    // Only the refresh/logout endpoints ever need it.
    path: '/auth',
    domain: process.env.COOKIE_DOMAIN || undefined,
  };
}

export function readRefreshCookie(req: Request): string | null {
  const header = req.headers.cookie;
  if (!header) return null;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === REFRESH_COOKIE) {
      return decodeURIComponent(part.slice(i + 1).trim()) || null;
    }
  }
  return null;
}

/**
 * Cookie-authenticated endpoints must carry a custom header. Browsers won't
 * attach one cross-site without a CORS preflight our origin allow-list
 * refuses, so a forged form post or <img> can't spend or clear the cookie
 * even if the cookie is SameSite=None.
 */
export function assertCsrfHeader(req: Request) {
  if (!req.headers['x-requested-with']) {
    throw new BadRequestException('Missing X-Requested-With header');
  }
}

export function setRefreshCookie(res: Response, token: string) {
  res.cookie(REFRESH_COOKIE, token, {
    ...refreshCookieOptions(),
    maxAge: REFRESH_TTL_MS,
  });
}

export function clearRefreshCookie(res: Response) {
  res.clearCookie(REFRESH_COOKIE, refreshCookieOptions());
}

/** Any handler returning a token pair (signup, login, refresh, switch-org,
 *  invite accept/register) gets its refresh token moved into the cookie. */
@Injectable()
export class RefreshCookieInterceptor implements NestInterceptor {
  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (ctx.getType() !== 'http') return next.handle();
    const res = ctx.switchToHttp().getResponse<Response>();
    return next.handle().pipe(
      map((body: unknown) => {
        if (
          body &&
          typeof body === 'object' &&
          typeof (body as { refreshToken?: unknown }).refreshToken === 'string'
        ) {
          const { refreshToken, ...rest } = body as { refreshToken: string };
          setRefreshCookie(res, refreshToken);
          return rest;
        }
        return body;
      }),
    );
  }
}
