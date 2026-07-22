import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Inject, Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import Papa from 'papaparse';
import { Pool, PoolClient } from 'pg';
import { PG_POOL } from '../../db/db.module';
import { withOrgContext } from '../../db/tenant-context';
import { LEAD_IMPORT_QUEUE } from '../../queue/queue.module';
import type { ImportJobData } from './import.dto';

const SCORES = new Set(['hot', 'warm', 'cold']);
const MAX_ROWS = 10_000;

interface RowError {
  row: number;
  reason: string;
}

@Processor(LEAD_IMPORT_QUEUE)
export class ImportProcessor extends WorkerHost {
  private readonly logger = new Logger(ImportProcessor.name);

  constructor(@Inject(PG_POOL) private readonly pool: Pool) {
    super();
  }

  async process(job: Job<ImportJobData>): Promise<void> {
    const { jobId, orgId, csv, mapping, onDuplicate } = job.data;
    try {
      await this.run(jobId, orgId, csv, mapping, onDuplicate);
    } catch (err) {
      this.logger.error(`Import ${jobId} failed`, err as Error);
      await withOrgContext(this.pool, orgId, (c) =>
        c.query(
          `UPDATE import_jobs SET status = 'failed', finished_at = now() WHERE id = $1`,
          [jobId],
        ),
      );
      throw err;
    }
  }

  private normalize(field: string, value: string): string | null {
    const v = value.trim();
    if (!v) return null;
    if (field === 'email') return v.toLowerCase();
    if (field === 'score')
      return SCORES.has(v.toLowerCase()) ? v.toLowerCase() : null;
    return v;
  }

  private async run(
    jobId: string,
    orgId: string,
    csv: string,
    mapping: Record<string, string>,
    onDuplicate: 'skip' | 'update',
  ) {
    const parsed = Papa.parse<Record<string, string>>(csv, {
      header: true,
      skipEmptyLines: true,
    });
    const rows = parsed.data.slice(0, MAX_ROWS);

    let imported = 0;
    let updated = 0;
    let skipped = 0;
    const errors: RowError[] = [];

    await withOrgContext(this.pool, orgId, async (c) => {
      await c.query(
        `UPDATE import_jobs SET status = 'processing', total = $2 WHERE id = $1`,
        [jobId, rows.length],
      );

      for (let i = 0; i < rows.length; i++) {
        const src = rows[i];
        const lead: Record<string, string | null> = {};
        for (const [col, field] of Object.entries(mapping)) {
          if (src[col] !== undefined) {
            lead[field] = this.normalize(field, src[col]);
          }
        }

        const hasIdentity =
          lead.email || lead.firstName || lead.lastName || lead.company;
        if (!hasIdentity) {
          skipped++;
          errors.push({ row: i + 2, reason: 'No email, name, or company' });
          continue;
        }

        await c.query('SAVEPOINT row_sp');
        try {
          const outcome = await this.upsertRow(c, orgId, lead, onDuplicate);
          await c.query('RELEASE SAVEPOINT row_sp');
          if (outcome === 'imported') imported++;
          else if (outcome === 'updated') updated++;
          else skipped++;
        } catch (err) {
          await c.query('ROLLBACK TO SAVEPOINT row_sp');
          skipped++;
          errors.push({
            row: i + 2,
            reason: err instanceof Error ? err.message : 'Row failed',
          });
        }
      }

      await c.query(
        `UPDATE import_jobs
         SET status = 'completed', imported = $2, updated = $3, skipped = $4,
             errors = $5::jsonb, finished_at = now()
         WHERE id = $1`,
        [
          jobId,
          imported,
          updated,
          skipped,
          JSON.stringify(errors.slice(0, 500)),
        ],
      );
    });
  }

  private async upsertRow(
    c: PoolClient,
    orgId: string,
    lead: Record<string, string | null>,
    onDuplicate: 'skip' | 'update',
  ): Promise<'imported' | 'updated' | 'skipped'> {
    if (lead.email) {
      const existing = await c.query<{ id: string }>(
        `SELECT id FROM leads WHERE lower(email) = lower($1) LIMIT 1`,
        [lead.email],
      );
      if ((existing.rowCount ?? 0) > 0) {
        if (onDuplicate === 'skip') return 'skipped';
        const id = existing.rows[0].id;
        await c.query(
          `UPDATE leads SET
             first_name = COALESCE($2, first_name),
             last_name  = COALESCE($3, last_name),
             company    = COALESCE($4, company),
             title      = COALESCE($5, title),
             phone      = COALESCE($6, phone),
             status     = COALESCE($7, status),
             score      = COALESCE($8, score),
             source     = COALESCE($9, source),
             updated_at = now()
           WHERE id = $1`,
          [
            id,
            lead.firstName ?? null,
            lead.lastName ?? null,
            lead.company ?? null,
            lead.title ?? null,
            lead.phone ?? null,
            lead.status ?? null,
            lead.score ?? null,
            lead.source ?? null,
          ],
        );
        await this.event(c, orgId, id, 'updated');
        return 'updated';
      }
    }

    const res = await c.query<{ id: string }>(
      `INSERT INTO leads
         (org_id, email, first_name, last_name, company, title, phone, status, score, source)
       VALUES ($1,$2,$3,$4,$5,$6,$7,COALESCE($8,'new'),$9,COALESCE($10,'csv'))
       RETURNING id`,
      [
        orgId,
        lead.email ?? null,
        lead.firstName ?? null,
        lead.lastName ?? null,
        lead.company ?? null,
        lead.title ?? null,
        lead.phone ?? null,
        lead.status ?? null,
        lead.score ?? null,
        lead.source ?? null,
      ],
    );
    await this.event(c, orgId, res.rows[0].id, 'imported');
    return 'imported';
  }

  private event(c: PoolClient, orgId: string, leadId: string, type: string) {
    return c.query(
      `INSERT INTO lead_events (org_id, lead_id, type, data) VALUES ($1,$2,$3,'{}'::jsonb)`,
      [orgId, leadId, type],
    );
  }
}
