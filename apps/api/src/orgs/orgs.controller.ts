import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Patch,
  Post,
} from '@nestjs/common';
import { Pool } from 'pg';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import type { AuthUser } from '../auth/types';
import { PG_POOL } from '../db/db.module';
import { withOrgContext } from '../db/tenant-context';
import { UpdateOrgDto } from './orgs.dto';
import { OrgsService } from './orgs.service';

@Controller('orgs')
export class OrgsController {
  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    private readonly orgs: OrgsService,
  ) {}

  @Get('me')
  current(@CurrentUser() user: AuthUser) {
    return this.orgs.get(user.orgId);
  }

  @Roles('admin')
  @Patch('me')
  update(@CurrentUser() user: AuthUser, @Body() dto: UpdateOrgDto) {
    return this.orgs.update(user.orgId, dto);
  }

  @Get('me/setup')
  setup(@CurrentUser() user: AuthUser) {
    return this.orgs.setup(user.orgId);
  }

  @Roles('admin')
  @Post('me/onboarding/complete')
  @HttpCode(200)
  completeOnboarding(@CurrentUser() user: AuthUser) {
    return this.orgs.completeOnboarding(user.orgId);
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
