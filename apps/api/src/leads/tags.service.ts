import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Pool, DatabaseError } from 'pg';
import { PG_POOL } from '../db/db.module';
import { withOrgContext } from '../db/tenant-context';
import type { CreateTagDto } from './dto/lead.dto';

export interface TagRow {
  id: string;
  name: string;
  color: string;
  created_at: Date;
}

@Injectable()
export class TagsService {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  list(orgId: string) {
    return withOrgContext(this.pool, orgId, async (c) => {
      const res = await c.query<TagRow>(
        `SELECT id, name, color, created_at FROM tags ORDER BY lower(name)`,
      );
      return res.rows;
    });
  }

  create(orgId: string, dto: CreateTagDto) {
    return withOrgContext(this.pool, orgId, async (c) => {
      try {
        const res = await c.query<TagRow>(
          `INSERT INTO tags (org_id, name, color)
           VALUES ($1, $2, COALESCE($3, '#666666'))
           RETURNING id, name, color, created_at`,
          [orgId, dto.name.trim(), dto.color ?? null],
        );
        return res.rows[0];
      } catch (err) {
        if (err instanceof DatabaseError && err.code === '23505') {
          throw new ConflictException('Tag name already exists');
        }
        throw err;
      }
    });
  }

  attach(orgId: string, leadId: string, tagId: string) {
    return withOrgContext(this.pool, orgId, async (c) => {
      const lead = await c.query(`SELECT 1 FROM leads WHERE id = $1`, [leadId]);
      if (lead.rowCount === 0) throw new NotFoundException('Lead not found');
      const tag = await c.query(`SELECT 1 FROM tags WHERE id = $1`, [tagId]);
      if (tag.rowCount === 0) throw new NotFoundException('Tag not found');
      await c.query(
        `INSERT INTO lead_tags (org_id, lead_id, tag_id)
         VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
        [orgId, leadId, tagId],
      );
      return { attached: true };
    });
  }

  detach(orgId: string, leadId: string, tagId: string) {
    return withOrgContext(this.pool, orgId, async (c) => {
      await c.query(
        `DELETE FROM lead_tags WHERE lead_id = $1 AND tag_id = $2`,
        [leadId, tagId],
      );
      return { detached: true };
    });
  }
}
