import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  Injectable,
  NotFoundException,
  Param,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsString,
  Matches,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { Pool } from 'pg';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import type { AuthUser } from '../auth/types';
import { PG_POOL } from '../db/db.module';
import { withOrgContext } from '../db/tenant-context';

/**
 * Per-workspace lead status list (T2.3). Lead status stays free text on the
 * lead; this list drives pickers, kanban columns and colours. The six system
 * statuses are what reply automation and conversion write, so they can be
 * recoloured and reordered but never renamed or removed.
 */
export const SYSTEM_STATUSES = [
  'new',
  'contacted',
  'replied',
  'interested',
  'converted',
  'lost',
] as const;

export const STATUS_COLORS = [
  'gray',
  'blue',
  'teal',
  'green',
  'amber',
  'red',
  'purple',
] as const;

const DEFAULT_COLORS: Record<string, string> = {
  new: 'gray',
  contacted: 'blue',
  replied: 'teal',
  interested: 'green',
  converted: 'purple',
  lost: 'red',
};

export interface LeadStatus {
  name: string;
  color: string;
}

const NAME_RE = /^[\p{L}\p{N}][\p{L}\p{N} _-]*$/u;
const isSystem = (n: string) =>
  (SYSTEM_STATUSES as readonly string[]).includes(n);
const norm = (n: string) => n.trim().toLowerCase();

class StatusDto {
  @IsString() @MaxLength(40) @Matches(NAME_RE) name!: string;
  @IsIn(STATUS_COLORS) color!: string;
}

class ReplaceStatusesDto {
  @IsArray()
  @ArrayMaxSize(30)
  @ValidateNested({ each: true })
  @Type(() => StatusDto)
  statuses!: StatusDto[];
}

class RenameStatusDto {
  @IsString() @MaxLength(40) from!: string;
  @IsString() @MaxLength(40) @Matches(NAME_RE) to!: string;
}

@Injectable()
export class LeadStatusesService {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  private async stored(
    c: { query: Pool['query'] },
    orgId: string,
  ): Promise<LeadStatus[]> {
    const r = await c.query<{ lead_statuses: LeadStatus[] | null }>(
      `SELECT lead_statuses FROM orgs WHERE id = $1`,
      [orgId],
    );
    const list = r.rows[0]?.lead_statuses ?? [];
    // system statuses are always present, even on an old/partial list
    const missing = SYSTEM_STATUSES.filter(
      (s) => !list.some((x) => x.name === s),
    ).map((name) => ({ name, color: DEFAULT_COLORS[name] }));
    return [...list, ...missing];
  }

  list(orgId: string) {
    return withOrgContext(this.pool, orgId, async (c) => {
      const statuses = await this.stored(c, orgId);
      const counts = await c.query<{ status: string; n: number }>(
        `SELECT status, count(*)::int AS n FROM leads GROUP BY status`,
      );
      const n = new Map(counts.rows.map((r) => [r.status, r.n]));
      return statuses.map((s) => ({
        ...s,
        system: isSystem(s.name),
        count: n.get(s.name) ?? 0,
      }));
    });
  }

  /** Replace order/colours/custom entries. Removing a custom status that
   *  leads still use is refused — use DELETE with moveTo for that. */
  async replace(orgId: string, input: LeadStatus[]) {
    const statuses = input.map((s) => ({ name: norm(s.name), color: s.color }));
    const names = statuses.map((s) => s.name);
    if (new Set(names).size !== names.length) {
      throw new BadRequestException('Status names must be unique');
    }
    const missingSystem = SYSTEM_STATUSES.filter((s) => !names.includes(s));
    if (missingSystem.length) {
      throw new BadRequestException(
        `System statuses can't be removed: ${missingSystem.join(', ')}`,
      );
    }
    await withOrgContext(this.pool, orgId, async (c) => {
      const before = await this.stored(c, orgId);
      const dropped = before
        .map((s) => s.name)
        .filter((n) => !names.includes(n));
      if (dropped.length) {
        const used = await c.query<{ status: string }>(
          `SELECT DISTINCT status FROM leads WHERE status = ANY($1)`,
          [dropped],
        );
        if (used.rowCount) {
          throw new BadRequestException(
            `Still in use: ${used.rows.map((r) => r.status).join(', ')} — delete it with a replacement instead`,
          );
        }
      }
      await c.query(`UPDATE orgs SET lead_statuses = $2::jsonb WHERE id = $1`, [
        orgId,
        JSON.stringify(statuses),
      ]);
    });
    return this.list(orgId);
  }

  async rename(orgId: string, fromRaw: string, toRaw: string) {
    const from = norm(fromRaw);
    const to = norm(toRaw);
    if (isSystem(from)) {
      throw new BadRequestException(
        `"${from}" is a system status and can't be renamed`,
      );
    }
    const moved = await withOrgContext(this.pool, orgId, async (c) => {
      const list = await this.stored(c, orgId);
      if (!list.some((s) => s.name === from)) {
        throw new NotFoundException('Status not found');
      }
      if (list.some((s) => s.name === to)) {
        throw new BadRequestException(`"${to}" already exists`);
      }
      const next = list.map((s) => (s.name === from ? { ...s, name: to } : s));
      await c.query(`UPDATE orgs SET lead_statuses = $2::jsonb WHERE id = $1`, [
        orgId,
        JSON.stringify(next),
      ]);
      const r = await c.query(
        `UPDATE leads SET status = $2, updated_at = now() WHERE status = $1`,
        [from, to],
      );
      return r.rowCount ?? 0;
    });
    return { renamed: true, leadsMoved: moved };
  }

  async remove(orgId: string, nameRaw: string, moveToRaw = 'new') {
    const name = norm(nameRaw);
    const moveTo = norm(moveToRaw);
    if (isSystem(name)) {
      throw new BadRequestException(
        `"${name}" is a system status and can't be removed`,
      );
    }
    const moved = await withOrgContext(this.pool, orgId, async (c) => {
      const list = await this.stored(c, orgId);
      if (!list.some((s) => s.name === name)) {
        throw new NotFoundException('Status not found');
      }
      if (moveTo === name || !list.some((s) => s.name === moveTo)) {
        throw new BadRequestException('moveTo must be another existing status');
      }
      await c.query(`UPDATE orgs SET lead_statuses = $2::jsonb WHERE id = $1`, [
        orgId,
        JSON.stringify(list.filter((s) => s.name !== name)),
      ]);
      const r = await c.query(
        `UPDATE leads SET status = $2, updated_at = now() WHERE status = $1`,
        [name, moveTo],
      );
      return r.rowCount ?? 0;
    });
    return { removed: true, leadsMoved: moved };
  }
}

@Controller('lead-statuses')
export class LeadStatusesController {
  constructor(private readonly statuses: LeadStatusesService) {}

  @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.statuses.list(user.orgId);
  }

  @Roles('admin', 'manager')
  @Put()
  replace(@CurrentUser() user: AuthUser, @Body() dto: ReplaceStatusesDto) {
    return this.statuses.replace(user.orgId, dto.statuses);
  }

  @Roles('admin', 'manager')
  @Post('rename')
  rename(@CurrentUser() user: AuthUser, @Body() dto: RenameStatusDto) {
    return this.statuses.rename(user.orgId, dto.from, dto.to);
  }

  @Roles('admin', 'manager')
  @Delete(':name')
  remove(
    @CurrentUser() user: AuthUser,
    @Param('name') name: string,
    @Query('moveTo') moveTo?: string,
  ) {
    return this.statuses.remove(user.orgId, name, moveTo);
  }
}
