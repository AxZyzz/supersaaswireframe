import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import { ApiKeysService } from './api-keys.service';

export interface ApiKeyContext {
  orgId: string;
}

/** Guards the public /v1 API: resolves the org from an `X-Api-Key` header. */
@Injectable()
export class ApiKeyGuard implements CanActivate {
  constructor(private readonly keys: ApiKeysService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx
      .switchToHttp()
      .getRequest<Request & { apiKey?: ApiKeyContext }>();
    const header = req.headers['x-api-key'];
    const raw = Array.isArray(header) ? header[0] : header;
    if (!raw) throw new UnauthorizedException('Missing X-Api-Key header');

    const result = await this.keys.verify(raw);
    if (!result) throw new UnauthorizedException('Invalid or revoked API key');

    req.apiKey = { orgId: result.orgId };
    return true;
  }
}
