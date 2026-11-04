import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DatabaseError, Pool } from 'pg';
import { PG_POOL } from '../db/db.module';
import { withOrgContext } from '../db/tenant-context';
import { SendersService } from '../senders/senders.service';
import {
  renderTemplate,
  SAMPLE_VARS,
  TemplateVars,
  varsFromLead,
} from './render';
import type {
  CreateFolderDto,
  CreateTemplateDto,
  UpdateTemplateDto,
} from './template.dto';

const COLS = `id, folder_id, name, subject, body_html, body_text,
  created_at, updated_at`;

export interface TemplateRow {
  id: string;
  folder_id: string | null;
  name: string;
  subject: string;
  body_html: string;
  body_text: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface FolderRow {
  id: string;
  name: string;
  created_at: Date;
}

@Injectable()
export class TemplatesService {
  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    private readonly senders: SendersService,
  ) {}

  // ── folders ──────────────────────────────────────────────────────────
  listFolders(orgId: string) {
    return withOrgContext(this.pool, orgId, async (c) => {
      const res = await c.query<FolderRow>(
        `SELECT id, name, created_at FROM template_folders ORDER BY lower(name)`,
      );
      return res.rows;
    });
  }

  createFolder(orgId: string, dto: CreateFolderDto) {
    return withOrgContext(this.pool, orgId, async (c) => {
      try {
        const res = await c.query<FolderRow>(
          `INSERT INTO template_folders (org_id, name) VALUES ($1, $2)
           RETURNING id, name, created_at`,
          [orgId, dto.name.trim()],
        );
        return res.rows[0];
      } catch (err) {
        if (err instanceof DatabaseError && err.code === '23505') {
          throw new ConflictException('Folder name already exists');
        }
        throw err;
      }
    });
  }

  async removeFolder(orgId: string, id: string) {
    // Templates in the folder are kept (folder_id set null via FK).
    const affected = await withOrgContext(this.pool, orgId, async (c) => {
      const res = await c.query(`DELETE FROM template_folders WHERE id = $1`, [
        id,
      ]);
      return res.rowCount ?? 0;
    });
    if (affected === 0) throw new NotFoundException('Folder not found');
    return { deleted: true };
  }

  // ── templates ────────────────────────────────────────────────────────
  list(orgId: string, folderId?: string) {
    return withOrgContext(this.pool, orgId, async (c) => {
      const res = folderId
        ? await c.query<TemplateRow>(
            `SELECT ${COLS} FROM templates WHERE folder_id = $1
             ORDER BY created_at DESC`,
            [folderId],
          )
        : await c.query<TemplateRow>(
            `SELECT ${COLS} FROM templates ORDER BY created_at DESC`,
          );
      return res.rows;
    });
  }

  create(orgId: string, dto: CreateTemplateDto) {
    return withOrgContext(this.pool, orgId, async (c) => {
      const res = await c.query<TemplateRow>(
        `INSERT INTO templates (org_id, folder_id, name, subject, body_html, body_text)
         VALUES ($1,$2,$3,COALESCE($4,''),COALESCE($5,''),$6)
         RETURNING ${COLS}`,
        [
          orgId,
          dto.folderId ?? null,
          dto.name.trim(),
          dto.subject ?? null,
          dto.bodyHtml ?? null,
          dto.bodyText ?? null,
        ],
      );
      return res.rows[0];
    });
  }

  get(orgId: string, id: string) {
    return withOrgContext(this.pool, orgId, async (c) => {
      const res = await c.query<TemplateRow>(
        `SELECT ${COLS} FROM templates WHERE id = $1`,
        [id],
      );
      if (res.rowCount === 0) throw new NotFoundException('Template not found');
      return res.rows[0];
    });
  }

  async update(orgId: string, id: string, dto: UpdateTemplateDto) {
    const sets: string[] = [];
    const params: unknown[] = [];
    const add = (col: string, v: unknown) => {
      params.push(v);
      sets.push(`${col} = $${params.length}`);
    };
    if (dto.name !== undefined) add('name', dto.name.trim());
    if (dto.subject !== undefined) add('subject', dto.subject);
    if (dto.bodyHtml !== undefined) add('body_html', dto.bodyHtml);
    if (dto.bodyText !== undefined) add('body_text', dto.bodyText);
    if (dto.folderId !== undefined) add('folder_id', dto.folderId); // null clears
    if (sets.length === 0) return this.get(orgId, id);
    sets.push('updated_at = now()');
    params.push(id);
    return withOrgContext(this.pool, orgId, async (c) => {
      const res = await c.query<TemplateRow>(
        `UPDATE templates SET ${sets.join(', ')} WHERE id = $${params.length}
         RETURNING ${COLS}`,
        params,
      );
      if (res.rowCount === 0) throw new NotFoundException('Template not found');
      return res.rows[0];
    });
  }

  async remove(orgId: string, id: string) {
    const affected = await withOrgContext(this.pool, orgId, async (c) => {
      const res = await c.query(`DELETE FROM templates WHERE id = $1`, [id]);
      return res.rowCount ?? 0;
    });
    if (affected === 0) throw new NotFoundException('Template not found');
    return { deleted: true };
  }

  async duplicate(orgId: string, id: string) {
    return withOrgContext(this.pool, orgId, async (c) => {
      const res = await c.query<TemplateRow>(
        `INSERT INTO templates (org_id, folder_id, name, subject, body_html, body_text)
         SELECT org_id, folder_id, name || ' (copy)', subject, body_html, body_text
         FROM templates WHERE id = $1
         RETURNING ${COLS}`,
        [id],
      );
      if (res.rowCount === 0) throw new NotFoundException('Template not found');
      return res.rows[0];
    });
  }

  // Render subject + body against a real lead's data, or sample data if no
  // leadId is given.
  async preview(orgId: string, id: string, leadId?: string) {
    return withOrgContext(this.pool, orgId, async (c) => {
      const t = await c.query<TemplateRow>(
        `SELECT ${COLS} FROM templates WHERE id = $1`,
        [id],
      );
      if (t.rowCount === 0) throw new NotFoundException('Template not found');
      const tpl = t.rows[0];

      let vars: TemplateVars = SAMPLE_VARS;
      if (leadId) {
        const lead = await c.query<{
          first_name: string | null;
          last_name: string | null;
          company: string | null;
          title: string | null;
          email: string | null;
          phone: string | null;
        }>(
          `SELECT first_name, last_name, company, title, email, phone
           FROM leads WHERE id = $1`,
          [leadId],
        );
        if (lead.rowCount === 0) throw new NotFoundException('Lead not found');
        vars = { ...varsFromLead(lead.rows[0]), sender_name: 'Jordan Lee' };
      }
      return {
        subject: renderTemplate(tpl.subject, vars),
        html: renderTemplate(tpl.body_html, vars, { html: true }),
        text: tpl.body_text ? renderTemplate(tpl.body_text, vars) : null,
      };
    });
  }

  // Render against sample data, then deliver a real message through the chosen
  // sender's provider (mock in dev). Proves the template end to end.
  async testSend(orgId: string, id: string, senderId: string, to: string) {
    const tpl = await this.get(orgId, id);
    if (!tpl.subject && !tpl.body_html) {
      throw new BadRequestException('Template has no subject or body');
    }
    const vars = SAMPLE_VARS;
    return this.senders.sendMessage(orgId, senderId, {
      to,
      subject: renderTemplate(tpl.subject, vars) || '(no subject)',
      html: renderTemplate(tpl.body_html, vars, { html: true }),
      text: tpl.body_text ? renderTemplate(tpl.body_text, vars) : undefined,
    });
  }
}
