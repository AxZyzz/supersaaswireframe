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

@Injectable()
export class ImportService {
  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    @InjectQueue(LEAD_IMPORT_QUEUE) private readonly queue: Queue,
  ) {}

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
