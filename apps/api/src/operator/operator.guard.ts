import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
  SetMetadata,
} from '@nestjs/common';
import { Pool } from 'pg';
import type { AuthUser } from '../auth/types';
import { PG_POOL } from '../db/db.module';

/** Marks operator-only routes (read by the authz matrix test as well). */
export const OPERATOR_KEY = 'operatorOnly';
export const OperatorOnly = () => SetMetadata(OPERATOR_KEY, true);

/**
 * A2B staff only. Checked against users.is_operator on every request — no
 * cache, so revoking via the CLI takes effect immediately. Runs after the
 * global JWT guard, so req.user is always set here.
 */
@Injectable()
export class OperatorGuard implements CanActivate {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const { user } = ctx.switchToHttp().getRequest<{ user?: AuthUser }>();
    if (!user) throw new ForbiddenException('Operators only');
    const r = await this.pool.query<{ is_operator: boolean }>(
      `SELECT is_operator FROM users WHERE id = $1`,
      [user.userId],
    );
    if (!r.rows[0]?.is_operator) throw new ForbiddenException('Operators only');
    return true;
  }
}
