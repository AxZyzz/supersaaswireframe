import { Controller, Get, Inject } from '@nestjs/common';
import { Pool } from 'pg';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import type { AuthUser } from '../auth/types';
import { PG_POOL } from '../db/db.module';
import { withOrgContext } from '../db/tenant-context';

@Controller('orgs')
export class OrgsController {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  @Get('me')
  current(@CurrentUser() user: AuthUser) {
    return withOrgContext(this.pool, user.orgId, async (c) => {
      const res = await c.query<{ id: string; name: string; slug: string }>(
        `SELECT id, name, slug FROM orgs WHERE id = $1`,
        [user.orgId],
      );
      return res.rows[0] ?? null;
    });
  }

  @Roles('admin', 'manager')
  @Get('members')
  members(@CurrentUser() user: AuthUser) {
    return withOrgContext(this.pool, user.orgId, async (c) => {
      const res = await c.query<{
        user_id: string;
        role: string;
        name: string;
        email: string;
      }>(
        // users is a global table; membership rows are RLS-scoped to this org,
        // so the join can only ever surface this org's members.
        `SELECT m.user_id, m.role, u.name, u.email
         FROM memberships m JOIN users u ON u.id = m.user_id
         ORDER BY m.created_at`,
      );
      return res.rows;
    });
  }
}
