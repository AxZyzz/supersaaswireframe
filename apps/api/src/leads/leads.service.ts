import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { Pool, PoolClient } from 'pg';
import { PG_POOL } from '../db/db.module';
import { withOrgContext } from '../db/tenant-context';
import type {
  CreateLeadDto,
  CreateNoteDto,
  ListLeadsQuery,
  UpdateLeadDto,
} from './dto/lead.dto';

const LEAD_COLS = `id, email, first_name, last_name, company, title, phone,
  status, score, source, custom, created_at, updated_at`;

export interface LeadRow {
  id: string;
  email: string | null;
  first_name: string | null;
  last_name: string | null;
  company: string | null;
  title: string | null;
  phone: string | null;
  status: string;
  score: 'hot' | 'warm' | 'cold' | null;
  source: string | null;
  custom: Record<string, unknown>;
  created_at: Date;
  updated_at: Date;
}
export interface TagRow {
  id: string;
  name: string;
  color: string;
}
export interface NoteRow {
  id: string;
  body: string;
  author_user_id: string | null;
  created_at: Date;
}
export interface EventRow {
  id: string;
  type: string;
  data: Record<string, unknown>;
  created_at: Date;
}

const SORT_COLUMN: Record<string, string> = {
  created_at: 'created_at',
  updated_at: 'updated_at',
  email: 'email',
  company: 'company',
  last_name: 'last_name',
};

@Injectable()
export class LeadsService {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  private run<T>(orgId: string, fn: (c: PoolClient) => Promise<T>) {
    return withOrgContext(this.pool, orgId, fn);
  }

  async list(orgId: string, q: ListLeadsQuery) {
    const limit = q.limit ?? 50;
    const offset = q.offset ?? 0;
    const where: string[] = [];
    const params: unknown[] = [];
    const add = (v: unknown) => {
      params.push(v);
      return `$${params.length}`;
    };

    if (q.search) {
      const p = add(`%${q.search}%`);
      where.push(
        `(email ILIKE ${p} OR first_name ILIKE ${p} OR last_name ILIKE ${p} OR company ILIKE ${p})`,
      );
    }
    if (q.status) where.push(`status = ${add(q.status)}`);
    if (q.score) where.push(`score = ${add(q.score)}`);
    if (q.source) where.push(`source = ${add(q.source)}`);
    if (q.tagId) {
      where.push(
        `id IN (SELECT lead_id FROM lead_tags WHERE tag_id = ${add(q.tagId)})`,
      );
    }

    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const sortCol = SORT_COLUMN[q.sort ?? 'created_at'];
    const order = q.order === 'asc' ? 'ASC' : 'DESC';
    const limitP = add(limit);
    const offsetP = add(offset);

    return this.run(orgId, async (c) => {
      const rows = await c.query<LeadRow>(
        `SELECT ${LEAD_COLS} FROM leads ${whereSql}
         ORDER BY ${sortCol} ${order}, id ${order}
         LIMIT ${limitP} OFFSET ${offsetP}`,
        params,
      );
      const countParams = params.slice(0, params.length - 2);
      const total = await c.query<{ count: string }>(
        `SELECT count(*)::int AS count FROM leads ${whereSql}`,
        countParams,
      );
      return {
        data: rows.rows,
        total: total.rows[0]?.count ?? 0,
        limit,
        offset,
      };
    });
  }

  // Same filters as list(), but no pagination — streams every match (capped)
  // for CSV export.
  async exportRows(orgId: string, q: ListLeadsQuery): Promise<LeadRow[]> {
    const where: string[] = [];
    const params: unknown[] = [];
    const add = (v: unknown) => {
      params.push(v);
      return `$${params.length}`;
    };
    if (q.search) {
      const p = add(`%${q.search}%`);
      where.push(
        `(email ILIKE ${p} OR first_name ILIKE ${p} OR last_name ILIKE ${p} OR company ILIKE ${p})`,
      );
    }
    if (q.status) where.push(`status = ${add(q.status)}`);
    if (q.score) where.push(`score = ${add(q.score)}`);
    if (q.source) where.push(`source = ${add(q.source)}`);
    if (q.tagId) {
      where.push(
        `id IN (SELECT lead_id FROM lead_tags WHERE tag_id = ${add(q.tagId)})`,
      );
    }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    return this.run(orgId, async (c) => {
      const res = await c.query<LeadRow>(
        `SELECT ${LEAD_COLS} FROM leads ${whereSql}
         ORDER BY created_at DESC LIMIT 50000`,
        params,
      );
      return res.rows;
    });
  }

  async create(orgId: string, dto: CreateLeadDto) {
    return this.run(orgId, async (c) => {
      const res = await c.query<LeadRow>(
        `INSERT INTO leads
           (org_id, email, first_name, last_name, company, title, phone,
            status, score, source, custom)
         VALUES ($1,$2,$3,$4,$5,$6,$7,COALESCE($8,'new'),$9,$10,COALESCE($11,'{}'::jsonb))
         RETURNING ${LEAD_COLS}`,
        [
          orgId,
          dto.email ?? null,
          dto.firstName ?? null,
          dto.lastName ?? null,
          dto.company ?? null,
          dto.title ?? null,
          dto.phone ?? null,
          dto.status ?? null,
          dto.score ?? null,
          dto.source ?? null,
          dto.custom ? JSON.stringify(dto.custom) : null,
        ],
      );
      const lead = res.rows[0];
      await c.query(
        `INSERT INTO lead_events (org_id, lead_id, type, data)
         VALUES ($1, $2, 'created', '{}'::jsonb)`,
        [orgId, lead.id],
      );
      return lead;
    });
  }

  async findOne(orgId: string, id: string) {
    return this.run(orgId, async (c) => {
      const lead = await c.query<LeadRow>(
        `SELECT ${LEAD_COLS} FROM leads WHERE id = $1`,
        [id],
      );
      if (lead.rowCount === 0) throw new NotFoundException('Lead not found');
      const tags = await c.query<TagRow>(
        `SELECT t.id, t.name, t.color FROM lead_tags lt
         JOIN tags t ON t.id = lt.tag_id WHERE lt.lead_id = $1`,
        [id],
      );
      const notes = await c.query<NoteRow>(
        `SELECT id, body, author_user_id, created_at FROM lead_notes
         WHERE lead_id = $1 ORDER BY created_at DESC`,
        [id],
      );
      const events = await c.query<EventRow>(
        `SELECT id, type, data, created_at FROM lead_events
         WHERE lead_id = $1 ORDER BY created_at DESC LIMIT 100`,
        [id],
      );
      return {
        ...lead.rows[0],
        tags: tags.rows,
        notes: notes.rows,
        events: events.rows,
      };
    });
  }

  async update(orgId: string, id: string, dto: UpdateLeadDto) {
    const sets: string[] = [];
    const params: unknown[] = [];
    const add = (col: string, v: unknown) => {
      params.push(v);
      sets.push(`${col} = $${params.length}`);
    };
    if (dto.email !== undefined) add('email', dto.email);
    if (dto.firstName !== undefined) add('first_name', dto.firstName);
    if (dto.lastName !== undefined) add('last_name', dto.lastName);
    if (dto.company !== undefined) add('company', dto.company);
    if (dto.title !== undefined) add('title', dto.title);
    if (dto.phone !== undefined) add('phone', dto.phone);
    if (dto.status !== undefined) add('status', dto.status);
    if (dto.score !== undefined) add('score', dto.score);
    if (dto.source !== undefined) add('source', dto.source);
    if (dto.custom !== undefined) add('custom', JSON.stringify(dto.custom));

    return this.run(orgId, async (c) => {
      if (sets.length > 0) {
        sets.push(`updated_at = now()`);
        params.push(id);
        const res = await c.query<LeadRow>(
          `UPDATE leads SET ${sets.join(', ')} WHERE id = $${params.length}
           RETURNING ${LEAD_COLS}`,
          params,
        );
        if (res.rowCount === 0) throw new NotFoundException('Lead not found');
        await c.query(
          `INSERT INTO lead_events (org_id, lead_id, type, data)
           VALUES ($1, $2, 'updated', $3::jsonb)`,
          [orgId, id, JSON.stringify({ fields: sets.length - 1 })],
        );
        return res.rows[0];
      }
      const res = await c.query<LeadRow>(
        `SELECT ${LEAD_COLS} FROM leads WHERE id = $1`,
        [id],
      );
      if (res.rowCount === 0) throw new NotFoundException('Lead not found');
      return res.rows[0];
    });
  }

  async remove(orgId: string, id: string) {
    return this.run(orgId, async (c) => {
      const res = await c.query(`DELETE FROM leads WHERE id = $1`, [id]);
      if (res.rowCount === 0) throw new NotFoundException('Lead not found');
      return { deleted: true };
    });
  }

  // Duplicate groups: leads sharing a normalized (first+last+company) key.
  // Exact-email dups can't exist (unique index), so this catches the same
  // person imported under different emails / no email.
  async duplicates(orgId: string) {
    return this.run(orgId, async (c) => {
      const res = await c.query<LeadRow & { dup_key: string }>(
        `WITH keyed AS (
           SELECT ${LEAD_COLS},
             lower(trim(coalesce(first_name,''))) || '·' ||
             lower(trim(coalesce(last_name,'')))  || '·' ||
             lower(trim(coalesce(company,'')))     AS dup_key
           FROM leads
           WHERE first_name IS NOT NULL AND company IS NOT NULL
         ),
         dups AS (
           SELECT dup_key FROM keyed GROUP BY dup_key HAVING count(*) > 1
         )
         SELECT k.* FROM keyed k JOIN dups d ON d.dup_key = k.dup_key
         ORDER BY k.dup_key, k.created_at`,
      );
      const groups = new Map<string, LeadRow[]>();
      for (const row of res.rows) {
        const { dup_key, ...lead } = row;
        const g = groups.get(dup_key) ?? [];
        g.push(lead);
        groups.set(dup_key, g);
      }
      return Array.from(groups.values()).map((leads) => ({
        count: leads.length,
        leads,
      }));
    });
  }

  // Merge secondary leads into a primary: move tags/notes/events, fill the
  // primary's empty fields from the oldest secondary, delete the secondaries.
  async merge(orgId: string, primaryId: string, mergeIds: string[]) {
    const ids = mergeIds.filter((id) => id !== primaryId);
    if (ids.length === 0) {
      throw new NotFoundException('Nothing to merge');
    }
    return this.run(orgId, async (c) => {
      const primary = await c.query(`SELECT id FROM leads WHERE id = $1`, [
        primaryId,
      ]);
      if (primary.rowCount === 0)
        throw new NotFoundException('Primary lead not found');
      const found = await c.query<{ id: string }>(
        `SELECT id FROM leads WHERE id = ANY($1::uuid[])`,
        [ids],
      );
      const realIds = found.rows.map((r) => r.id);
      if (realIds.length === 0)
        throw new NotFoundException('No leads to merge');

      // Move tags (skip ones the primary already has), notes, events.
      await c.query(
        `INSERT INTO lead_tags (org_id, lead_id, tag_id)
         SELECT org_id, $1, tag_id FROM lead_tags WHERE lead_id = ANY($2::uuid[])
         ON CONFLICT DO NOTHING`,
        [primaryId, realIds],
      );
      await c.query(`DELETE FROM lead_tags WHERE lead_id = ANY($1::uuid[])`, [
        realIds,
      ]);
      await c.query(
        `UPDATE lead_notes SET lead_id = $1 WHERE lead_id = ANY($2::uuid[])`,
        [primaryId, realIds],
      );
      await c.query(
        `UPDATE lead_events SET lead_id = $1 WHERE lead_id = ANY($2::uuid[])`,
        [primaryId, realIds],
      );

      // Fill the primary's null fields from the oldest secondary.
      await c.query(
        `UPDATE leads p SET
           email = COALESCE(p.email, m.email),
           first_name = COALESCE(p.first_name, m.first_name),
           last_name = COALESCE(p.last_name, m.last_name),
           company = COALESCE(p.company, m.company),
           title = COALESCE(p.title, m.title),
           phone = COALESCE(p.phone, m.phone),
           score = COALESCE(p.score, m.score),
           source = COALESCE(p.source, m.source),
           updated_at = now()
         FROM (
           SELECT * FROM leads WHERE id = ANY($2::uuid[])
           ORDER BY created_at LIMIT 1
         ) m
         WHERE p.id = $1`,
        [primaryId, realIds],
      );

      await c.query(`DELETE FROM leads WHERE id = ANY($1::uuid[])`, [realIds]);
      await c.query(
        `INSERT INTO lead_events (org_id, lead_id, type, data)
         VALUES ($1, $2, 'merged', $3::jsonb)`,
        [orgId, primaryId, JSON.stringify({ merged: realIds.length })],
      );
      return { merged: realIds.length, primaryId };
    });
  }

  async addNote(
    orgId: string,
    leadId: string,
    userId: string,
    dto: CreateNoteDto,
  ) {
    return this.run(orgId, async (c) => {
      const exists = await c.query(`SELECT 1 FROM leads WHERE id = $1`, [
        leadId,
      ]);
      if (exists.rowCount === 0) throw new NotFoundException('Lead not found');
      const res = await c.query<NoteRow>(
        `INSERT INTO lead_notes (org_id, lead_id, author_user_id, body)
         VALUES ($1, $2, $3, $4)
         RETURNING id, body, author_user_id, created_at`,
        [orgId, leadId, userId, dto.body],
      );
      await c.query(
        `INSERT INTO lead_events (org_id, lead_id, type, data)
         VALUES ($1, $2, 'note_added', '{}'::jsonb)`,
        [orgId, leadId],
      );
      return res.rows[0];
    });
  }
}
