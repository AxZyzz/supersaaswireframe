import { InjectQueue } from '@nestjs/bullmq';
import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Queue } from 'bullmq';
import { Pool } from 'pg';
import { PG_POOL } from '../../db/db.module';
import { withOrgContext } from '../../db/tenant-context';
import { LEAD_IMPORT_QUEUE } from '../../queue/queue.module';
import type { ImportableField, ImportJobData } from './import.dto';
import { AiService } from '../../ai/ai.service';
import {
  type Mapping,
  mappingPrompt,
  ruleMapping,
  sanitizeMapping,
} from './column-mapping';

export interface JobRow {
  id: string;
  source: string;
  status: string;
  total: number;
  imported: number;
  updated: number;
  skipped: number;
  errors: unknown[];
  created_at: Date;
  finished_at: Date | null;
}

/** A spreadsheet cell as text; anything that isn't a plain value is blank. */
const cell = (v: unknown): string =>
  typeof v === 'string'
    ? v
    : typeof v === 'number' || typeof v === 'boolean'
      ? String(v)
      : '';

@Injectable()
export class ImportService {
  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    @InjectQueue(LEAD_IMPORT_QUEUE) private readonly queue: Queue,
    private readonly ai: AiService,
  ) {}

  /**
   * Suggests column -> field matches from the headers and a few sample rows.
   * AI when a real model is configured (its answer is value-checked), rules
   * otherwise or if the AI call fails. The user reviews before importing.
   */
  async suggestMapping(
    orgId: string,
    headersIn: unknown,
    rowsIn: unknown,
  ): Promise<{ mapping: Mapping; source: 'ai' | 'rules' }> {
    if (!Array.isArray(headersIn) || headersIn.length === 0) {
      throw new BadRequestException('headers must be a non-empty list');
    }
    const headers = headersIn.slice(0, 100).map((h) => cell(h).slice(0, 200));
    const rows = (Array.isArray(rowsIn) ? rowsIn : [])
      .slice(0, 5)
      .map((r) =>
        Array.isArray(r)
          ? headers.map((_, i) => cell((r as unknown[])[i]).slice(0, 500))
          : [],
      );
    const rules = ruleMapping(headers, rows);
    if (this.ai.providerName() === 'mock') {
      return { mapping: rules, source: 'rules' };
    }
    try {
      const res = await this.ai.generate(
        orgId,
        'map-columns',
        mappingPrompt(headers, rows),
      );
      const parsed = JSON.parse(res.text) as { mapping?: unknown };
      const proposed: Record<string, unknown> = {};
      for (const m of Array.isArray(parsed.mapping) ? parsed.mapping : []) {
        const { column, field } = (m ?? {}) as {
          column?: unknown;
          field?: unknown;
        };
        if (typeof column === 'string') proposed[column] = field;
      }
      const ai = sanitizeMapping(proposed, headers, rows);
      // where the AI left a column empty, keep a rules match for a field it
      // didn't use
      const used = new Set(Object.values(ai).filter(Boolean));
      for (const h of headers) {
        const f = rules[h];
        if (!ai[h] && f && !used.has(f)) {
          ai[h] = f;
          used.add(f);
        }
      }
      return { mapping: ai, source: 'ai' };
    } catch {
      return { mapping: rules, source: 'rules' };
    }
  }

  async start(
    orgId: string,
    csv: string,
    mapping: Record<string, ImportableField>,
    onDuplicate: 'skip' | 'update',
    /** 'csv' (file upload) or 'google_sheet' (T2.8 sync). */
    source: 'csv' | 'google_sheet' = 'csv',
  ) {
    if (!csv.trim()) throw new BadRequestException('Empty file');
    if (!mapping || Object.values(mapping).length === 0) {
      throw new BadRequestException('No column mapping provided');
    }
    if (!Object.values(mapping).includes('email')) {
      throw new BadRequestException('Mapping must include an email column');
    }

    const job = await withOrgContext(this.pool, orgId, async (c) => {
      const res = await c.query<{ id: string }>(
        `INSERT INTO import_jobs (org_id, source, status) VALUES ($1, $2, 'pending') RETURNING id`,
        [orgId, source],
      );
      return res.rows[0];
    });

    const data: ImportJobData = {
      jobId: job.id,
      orgId,
      csv,
      mapping,
      onDuplicate,
      source,
    };
    await this.queue.add('import', data, {
      removeOnComplete: true,
      removeOnFail: 100,
      attempts: 1,
    });
    return { jobId: job.id, status: 'pending' };
  }

  async status(orgId: string, jobId: string) {
    return withOrgContext(this.pool, orgId, async (c) => {
      const res = await c.query<JobRow>(
        `SELECT id, source, status, total, imported, updated, skipped, errors,
                created_at, finished_at
         FROM import_jobs WHERE id = $1`,
        [jobId],
      );
      if (res.rowCount === 0) throw new NotFoundException('Import not found');
      return res.rows[0];
    });
  }
}
