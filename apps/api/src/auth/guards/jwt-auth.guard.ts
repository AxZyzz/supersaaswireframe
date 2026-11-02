import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import type { Request } from 'express';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { MembershipCache } from '../membership-cache.service';
import type { AccessTokenPayload, AuthUser } from '../types';

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly reflector: Reflector,
    private readonly memberships: MembershipCache,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (isPublic) return true;

    const req = ctx.switchToHttp().getRequest<Request & { user?: AuthUser }>();
    const header = req.headers.authorization;
    const token = header?.startsWith('Bearer ') ? header.slice(7) : undefined;
    if (!token) throw new UnauthorizedException('Missing bearer token');

    let payload: AccessTokenPayload;
    try {
      payload = await this.jwt.verifyAsync<AccessTokenPayload>(token);
    } catch {
      throw new UnauthorizedException('Invalid or expired token');
    }
    if (payload.type !== 'access') {
      throw new UnauthorizedException('Wrong token type');
    }

    // The token's role is a snapshot; authorize on the live membership so
    // removals and role changes take effect without waiting for expiry.
    const role = await this.memberships.role(payload.sub, payload.orgId);
    if (!role) {
      throw new UnauthorizedException('No longer a member of this workspace');
    }

    req.user = {
      userId: payload.sub,
      orgId: payload.orgId,
      role,
    };
    return true;
  }
}
