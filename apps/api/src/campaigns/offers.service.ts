import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  IsBoolean,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { Pool, PoolClient } from 'pg';
import { PG_POOL } from '../db/db.module';
import { withOrgContext } from '../db/tenant-context';

export class CreateOfferDto {
  @IsString() @MinLength(1) @MaxLength(120) name!: string;
  @IsOptional() @IsString() @MaxLength(600) description?: string;
}

export class UpdateOfferDto {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(120) name?: string;
  @IsOptional() @IsString() @MaxLength(600) description?: string | null;
  @IsOptional() @IsBoolean() archived?: boolean;
}

export interface OfferRow {
  id: string;
  org_id: string;
  name: string;
  description: string | null;
  created_at: Date;
  archived_at: Date | null;
}

const OFFER_COLS = `id, org_id, name, description, created_at, archived_at`;

@Injectable()
export class OffersService {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  private run<T>(orgId: string, fn: (c: PoolClient) => Promise<T>) {
    return withOrgContext(this.pool, orgId, fn);
  }

  /**
   * Ensures the workspace has at least one offer ("Default offer" created on
   * first use) and returns the active offer list.
   */
  async ensureDefaultInTx(c: PoolClient, orgId: string): Promise<OfferRow> {
    const existing = await c.query<OfferRow>(
      `SELECT ${OFFER_COLS} FROM offers
       WHERE archived_at IS NULL
       ORDER BY created_at ASC LIMIT 1`,
    );
    if (existing.rows[0]) return existing.rows[0];

    const kb = await c.query<{ offer: string | null }>(
      `SELECT offer FROM org_knowledge WHERE org_id = $1 LIMIT 1`,
      [orgId],
    );
    const created = await c.query<OfferRow>(
      `INSERT INTO offers (org_id, name, description)
       VALUES ($1, 'Default offer', $2)
       RETURNING ${OFFER_COLS}`,
      [orgId, kb.rows[0]?.offer ?? null],
    );
    return created.rows[0];
  }

  /**
   * Resolves an explicit offerId (verifying it belongs to this workspace) or
   * falls back to the workspace's default offer.
   */
  async resolveOfferIdInTx(
    c: PoolClient,
    orgId: string,
    offerId?: string | null,
  ): Promise<string> {
    if (offerId) {
      const r = await c.query<{ id: string }>(
        `SELECT id FROM offers WHERE id = $1`,
        [offerId],
      );
      if (r.rowCount === 0) {
        throw new BadRequestException('Unknown offer');
      }
      return r.rows[0].id;
    }
    const def = await this.ensureDefaultInTx(c, orgId);
    return def.id;
  }

  list(orgId: string): Promise<OfferRow[]> {
    return this.run(orgId, async (c) => {
      await this.ensureDefaultInTx(c, orgId);
      const r = await c.query<OfferRow>(
        `SELECT ${OFFER_COLS} FROM offers
         WHERE archived_at IS NULL
         ORDER BY created_at ASC`,
      );
      return r.rows;
    });
  }

  create(orgId: string, dto: CreateOfferDto): Promise<OfferRow> {
    const name = dto.name.trim();
    if (!name) throw new BadRequestException('Offer name is required');
    return this.run(orgId, async (c) => {
      const r = await c.query<OfferRow>(
        `INSERT INTO offers (org_id, name, description)
         VALUES ($1, $2, $3)
         RETURNING ${OFFER_COLS}`,
        [orgId, name, dto.description?.trim() || null],
      );
      return r.rows[0];
    });
  }

  update(orgId: string, id: string, dto: UpdateOfferDto): Promise<OfferRow> {
    return this.run(orgId, async (c) => {
      const sets: string[] = [];
      const params: unknown[] = [];
      const add = (col: string, val: unknown) => {
        params.push(val);
        sets.push(`${col} = $${params.length}`);
      };
      if (dto.name !== undefined) {
        const clean = dto.name.trim();
        if (!clean) throw new BadRequestException('Offer name is required');
        add('name', clean);
      }
      if (dto.description !== undefined) {
        add('description', dto.description?.trim() || null);
      }
      if (dto.archived !== undefined) {
        sets.push(
          dto.archived
            ? 'archived_at = COALESCE(archived_at, now())'
            : 'archived_at = NULL',
        );
      }
      if (sets.length === 0) {
        const cur = await c.query<OfferRow>(
          `SELECT ${OFFER_COLS} FROM offers WHERE id = $1`,
          [id],
        );
        if (!cur.rows[0]) throw new NotFoundException('Offer not found');
        return cur.rows[0];
      }
      params.push(id);
      const r = await c.query<OfferRow>(
        `UPDATE offers SET ${sets.join(', ')} WHERE id = $${params.length}
         RETURNING ${OFFER_COLS}`,
        params,
      );
      if (!r.rows[0]) throw new NotFoundException('Offer not found');
      return r.rows[0];
    });
  }
}
