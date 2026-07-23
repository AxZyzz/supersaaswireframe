import { InjectQueue } from '@nestjs/bullmq';
import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Queue } from 'bullmq';
import { DatabaseError, Pool, PoolClient } from 'pg';
import { PG_POOL } from '../../db/db.module';
import { withOrgContext } from '../../db/tenant-context';
import { SEGMENT_REFRESH_QUEUE } from '../../queue/queue.module';
import type { CreateSegmentDto, UpdateSegmentDto } from './segment.dto';
import { buildWhere, RuleSet } from './segment-rules';

export interface SegmentRow {
  id: string;
  name: string;
  type: string;
  rules: RuleSet;
  member_count: number;
  last_refreshed_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

@Injectable()
export class SegmentsService {
  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    @InjectQueue(SEGMENT_REFRESH_QUEUE) private readonly queue: Queue,
  ) {}

  private run<T>(orgId: string, fn: (c: PoolClient) => Promise<T>) {
    return withOrgContext(this.pool, orgId, fn);
  }

  private enqueue(orgId: string, segmentId: string) {
    return this.queue.add(
      'refresh',
      { orgId, segmentId },
      { removeOnComplete: true, removeOnFail: 50 },
    );
  }

  async create(orgId: string, dto: CreateSegmentDto) {
    if (dto.type === 'smart') {
      // Validate the rules eagerly so a bad rule set 400s at create time.
      buildWhere(dto.rules ?? { match: 'all', conditions: [] });
    }
    const seg = await this.run(orgId, async (c) => {
      try {
        const res = await c.query<SegmentRow>(
          `INSERT INTO segments (org_id, name, type, rules)
           VALUES ($1, $2, $3, $4::jsonb)
           RETURNING id, name, type, rules, member_count, last_refreshed_at, created_at, updated_at`,
          [
            orgId,
            dto.name.trim(),
            dto.type,
            JSON.stringify(dto.rules ?? { match: 'all', conditions: [] }),
          ],
        );
        return res.rows[0];
      } catch (err) {
        if (err instanceof DatabaseError && err.code === '23505') {
          throw new ConflictException('Segment name already exists');
        }
        throw err;
      }
    });
    if (seg.type === 'smart') await this.enqueue(orgId, seg.id);
    return seg;
  }

  list(orgId: string) {
    return this.run(orgId, async (c) => {
      const res = await c.query<SegmentRow>(
        `SELECT id, name, type, rules, member_count, last_refreshed_at, created_at, updated_at
         FROM segments ORDER BY lower(name)`,
      );
      return res.rows;
    });
  }

  get(orgId: string, id: string) {
    return this.run(orgId, async (c) => {
      const res = await c.query<SegmentRow>(
        `SELECT id, name, type, rules, member_count, last_refreshed_at, created_at, updated_at
         FROM segments WHERE id = $1`,
        [id],
      );
      if (res.rowCount === 0) throw new NotFoundException('Segment not found');
      return res.rows[0];
    });
  }

  async update(orgId: string, id: string, dto: UpdateSegmentDto) {
    const seg = await this.get(orgId, id);
    const sets: string[] = [];
    const params: unknown[] = [];
    const add = (col: string, v: unknown) => {
      params.push(v);
      sets.push(`${col} = $${params.length}`);
    };
    if (dto.name !== undefined) add('name', dto.name.trim());
    let rulesChanged = false;
    if (dto.rules !== undefined) {
      if (seg.type !== 'smart') {
        throw new BadRequestException('Only smart segments have rules');
      }
      buildWhere(dto.rules);
      params.push(JSON.stringify(dto.rules));
      sets.push(`rules = $${params.length}::jsonb`);
      rulesChanged = true;
    }
    if (sets.length === 0) return seg;
    sets.push(`updated_at = now()`);
    params.push(id);
    const updated = await this.run(orgId, async (c) => {
      const res = await c.query<SegmentRow>(
        `UPDATE segments SET ${sets.join(', ')} WHERE id = $${params.length}
         RETURNING id, name, type, rules, member_count, last_refreshed_at, created_at, updated_at`,
        params,
      );
      return res.rows[0];
    });
    if (rulesChanged) await this.enqueue(orgId, id);
    return updated;
  }

  async remove(orgId: string, id: string) {
    const affected = await this.run(orgId, async (c) => {
      const res = await c.query(`DELETE FROM segments WHERE id = $1`, [id]);
      return res.rowCount ?? 0;
    });
    if (affected === 0) throw new NotFoundException('Segment not found');
    return { deleted: true };
  }

  async requestRefresh(orgId: string, id: string) {
    const seg = await this.get(orgId, id);
    if (seg.type !== 'smart') {
      throw new BadRequestException('Only smart segments refresh from rules');
    }
    await this.enqueue(orgId, id);
    return { queued: true };
  }

  async members(orgId: string, id: string, limit = 50, offset = 0) {
    return this.run(orgId, async (c) => {
      await this.assertExists(c, id);
      const rows = await c.query(
        `SELECT l.id, l.email, l.first_name, l.last_name, l.company, l.status, l.score
         FROM segment_members sm JOIN leads l ON l.id = sm.lead_id
         WHERE sm.segment_id = $1
         ORDER BY l.created_at DESC LIMIT $2 OFFSET $3`,
        [id, limit, offset],
      );
      const total = await c.query<{ count: string }>(
        `SELECT count(*)::int AS count FROM segment_members WHERE segment_id = $1`,
        [id],
      );
      return {
        data: rows.rows,
        total: total.rows[0]?.count ?? 0,
        limit,
        offset,
      };
    });
  }

  // Manual-segment membership editing.
  async addMembers(orgId: string, id: string, leadIds: string[]) {
    const seg = await this.get(orgId, id);
    if (seg.type !== 'manual') {
      throw new BadRequestException('Only manual segments accept members');
    }
    return this.run(orgId, async (c) => {
      await c.query(
        `INSERT INTO segment_members (org_id, segment_id, lead_id)
         SELECT $1, $2, id FROM leads WHERE id = ANY($3::uuid[])
         ON CONFLICT DO NOTHING`,
        [orgId, id, leadIds],
      );
      return this.syncCount(c, id);
    });
  }

  async removeMember(orgId: string, id: string, leadId: string) {
    return this.run(orgId, async (c) => {
      await c.query(
        `DELETE FROM segment_members WHERE segment_id = $1 AND lead_id = $2`,
        [id, leadId],
      );
      return this.syncCount(c, id);
    });
  }

  // Recompute smart-segment membership from rules. Called by the worker.
  async refreshNow(orgId: string, id: string) {
    return this.run(orgId, async (c) => {
      const seg = await c.query<{ type: string; rules: RuleSet }>(
        `SELECT type, rules FROM segments WHERE id = $1`,
        [id],
      );
      if (seg.rowCount === 0) throw new NotFoundException('Segment not found');
      if (seg.rows[0].type !== 'smart') return this.syncCount(c, id);

      const { clause, params } = buildWhere(seg.rows[0].rules, 2);
      await c.query(`DELETE FROM segment_members WHERE segment_id = $1`, [id]);
      await c.query(
        `INSERT INTO segment_members (org_id, segment_id, lead_id)
         SELECT $1, $2, l.id FROM leads l WHERE ${clause}
         ON CONFLICT DO NOTHING`,
        [orgId, id, ...params],
      );
      const count = await this.syncCount(c, id, true);
      return count;
    });
  }

  private async assertExists(c: PoolClient, id: string) {
    const res = await c.query(`SELECT 1 FROM segments WHERE id = $1`, [id]);
    if (res.rowCount === 0) throw new NotFoundException('Segment not found');
  }

  private async syncCount(c: PoolClient, id: string, refreshed = false) {
    const res = await c.query<{ member_count: number }>(
      `UPDATE segments SET
         member_count = (SELECT count(*) FROM segment_members WHERE segment_id = $1)
         ${refreshed ? ', last_refreshed_at = now()' : ''}
       WHERE id = $1
       RETURNING member_count`,
      [id],
    );
    return { memberCount: res.rows[0]?.member_count ?? 0 };
  }
}
