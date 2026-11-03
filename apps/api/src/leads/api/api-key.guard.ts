import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ThrottlerException } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { RedisThrottlerStorage } from '../../auth/redis-throttler.storage';
import { ApiKeysService } from './api-keys.service';

export interface ApiKeyContext {
  orgId: string;
}

const WINDOW_MS = 60_000;

/**
 * Guards the public /v1 API: resolves the org from an `X-Api-Key` header and
 * enforces that key's own requests-per-minute budget (T2.9), counted in Redis
 * so every API instance shares it. Standard X-RateLimit-* headers tell
 * integrations where they stand; over budget → 429 with Retry-After.
 */
@Injectable()
export class ApiKeyGuard implements CanActivate {
  constructor(
    private readonly keys: ApiKeysService,
    private readonly limiter: RedisThrottlerStorage,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const http = ctx.switchToHttp();
    const req = http.getRequest<Request & { apiKey?: ApiKeyContext }>();
    const res = http.getResponse<Response>();
    const header = req.headers['x-api-key'];
    const raw = Array.isArray(header) ? header[0] : header;
    if (!raw) throw new UnauthorizedException('Missing X-Api-Key header');

    const key = await this.keys.verify(raw);
    if (!key) throw new UnauthorizedException('Invalid or revoked API key');

    const r = await this.limiter.increment(
      `key:${key.id}`,
      WINDOW_MS,
      key.rateLimit,
      WINDOW_MS,
      'apikey',
    );
    res.setHeader('X-RateLimit-Limit', String(key.rateLimit));
    res.setHeader(
      'X-RateLimit-Remaining',
      String(Math.max(0, key.rateLimit - r.totalHits)),
    );
    res.setHeader('X-RateLimit-Reset', String(r.timeToExpire));
    if (r.isBlocked) {
      res.setHeader('Retry-After', String(r.timeToBlockExpire || 1));
      throw new ThrottlerException(
        `API key rate limit exceeded (${key.rateLimit}/min)`,
      );
    }

    req.apiKey = { orgId: key.orgId };
    return true;
  }
}
