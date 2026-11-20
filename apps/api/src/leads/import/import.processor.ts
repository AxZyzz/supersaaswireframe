import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Inject, Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import Papa from 'papaparse';
import { Pool, PoolClient } from 'pg';
import { UsageService } from '../../usage/usage.service';
import { PG_POOL } from '../../db/db.module';
import { withOrgContext } from '../../db/tenant-context';
import { LEAD_IMPORT_QUEUE, WORKER_OPTIONS } from '../../queue/queue.module';
import type { ImportJobData } from './import.dto';
import { SYSTEM_STATUSES } from '../lead-statuses';
import { EMAIL_RE, MAX_LEN } from './column-mapping';
import { deriveLeadAttrs } from '../lead-attributes';
import { MailProviderService } from '../mail-provider.service';

const SCORES = new Set(['hot', 'warm', 'cold']);
const MAX_ROWS = 10_000;

interface RowError {
  row: number;
  reason: string;
}

@Processor(LEAD_IMPORT_QUEUE, WORKER_OPTIONS)
export class ImportProcessor extends WorkerHost {
  private readonly logger = new Logger(ImportProcessor.name);

  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    private readonly usage: UsageService,
    private readonly mailProvider: MailProviderService,
  ) {
    super();
  }

  async process(job: Job<ImportJobData>): Promise<void> {
    const { jobId, orgId, csv, mapping, onDuplicate, source } = job.data;
    try {
      await this.run(jobId, orgId, csv, mapping, onDuplicate, source ?? 'csv');
      // mail provider is looked up after the import, never inside it
      await this.mailProvider.enqueue(orgId);
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
    defaultSource: string,
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
      // New leads draw down the plan's lead budget; updates are free.
      const budget = { left: await this.usage.remaining(c, orgId, 'leads') };
      // Status values must be ones this workspace knows (system + custom);
      // anything else (e.g. an email-verification "Verified") is dropped.
      const st = await c.query<{ lead_statuses: { name: string }[] | null }>(
        `SELECT lead_statuses FROM orgs WHERE id = $1`,
        [orgId],
      );
      const statuses = new Map<string, string>(
        [
          ...SYSTEM_STATUSES,
          ...(st.rows[0]?.lead_statuses ?? []).map((s) => s.name),
        ].map((n) => [n.toLowerCase(), n]),
      );

      for (let i = 0; i < rows.length; i++) {
        const src = rows[i];
        const lead: Record<string, string | null> = {};
        for (const [col, field] of Object.entries(mapping)) {
          if (src[col] !== undefined) {
            lead[field] = this.normalize(field, src[col]);
          }
        }

        const dropped = this.clean(lead, statuses);

        const hasIdentity =
          lead.email || lead.firstName || lead.lastName || lead.company;
        if (!hasIdentity) {
          skipped++;
          errors.push({ row: i + 2, reason: 'No email, name, or company' });
          continue;
        }

        await c.query('SAVEPOINT row_sp');
        try {
          const outcome = await this.upsertRow(
            c,
            orgId,
            lead,
            onDuplicate,
            budget,
            defaultSource,
          );
          await c.query('RELEASE SAVEPOINT row_sp');
          if (dropped.length && outcome !== 'limit') {
            errors.push({
              row: i + 2,
              reason: `Imported without: ${dropped.join(', ')}`,
            });
          }
          if (outcome === 'imported') imported++;
          else if (outcome === 'updated') updated++;
          else {
            skipped++;
            if (outcome === 'limit') {
              errors.push({
                row: i + 2,
                reason: 'Lead limit reached for your plan',
              });
            }
          }
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

  /**
   * Fixes up one mapped row in place and returns what was left out: splits a
   * full name, drops values that can't be right (bad email, a paragraph or
   * JSON in a short field, an unknown status) instead of storing junk.
   */
  private clean(
    lead: Record<string, string | null>,
    statuses: Map<string, string>,
  ): string[] {
    const dropped: string[] = [];
    if ('fullName' in lead) {
      const full = lead.fullName;
      delete lead.fullName;
      if (
        full &&
        (full.length > (MAX_LEN.fullName ?? 200) || /^[[{]/.test(full))
      ) {
        dropped.push('name (not a name)');
      } else if (full && !lead.firstName && !lead.lastName) {
        const [first, ...rest] = full.split(/\s+/);
        lead.firstName = first || null;
        lead.lastName = rest.join(' ') || null;
      }
    }
    if (lead.email && !EMAIL_RE.test(lead.email)) {
      dropped.push('email (not a valid address)');
      lead.email = null;
    }
    for (const [field, max] of Object.entries(MAX_LEN)) {
      const v = lead[field];
      if (v && (v.length > max || /^[[{]/.test(v))) {
        dropped.push(`${field} (too long or not plain text)`);
        lead[field] = null;
      }
    }
    if (lead.status) {
      const known = statuses.get(lead.status.toLowerCase());
      if (!known)
        dropped.push(`status "${lead.status.slice(0, 40)}" (unknown)`);
      lead.status = known ?? null;
    }
    return dropped;
  }

  private async upsertRow(
    c: PoolClient,
    orgId: string,
    lead: Record<string, string | null>,
    onDuplicate: 'skip' | 'update',
    budget: { left: number },
    /** Source for NEW leads without a mapped source column; updates keep theirs. */
    defaultSource = 'csv',
  ): Promise<'imported' | 'updated' | 'skipped' | 'limit'> {
    const a = deriveLeadAttrs({
      email: lead.email,
      website: lead.website,
      city: lead.city,
      region: lead.region,
      country: lead.country,
    });
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
             company_key = COALESCE($10, company_key),
             city       = COALESCE($11, city),
             region     = COALESCE($12, region),
             country    = COALESCE($13, country),
             timezone   = COALESCE($14, timezone),
             custom     = CASE WHEN $15::text IS NULL THEN custom
                          ELSE jsonb_set(custom, '{website}', to_jsonb($15::text)) END,
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
            a.companyKey,
            a.city,
            a.region,
            a.country,
            a.timezone,
            lead.website ?? null,
          ],
        );
        await this.event(c, orgId, id, 'updated');
        return 'updated';
      }
    }

    if (budget.left <= 0) return 'limit';
    budget.left--;
    const res = await c.query<{ id: string }>(
      `INSERT INTO leads
         (org_id, email, first_name, last_name, company, title, phone, status, score, source,
          company_key, city, region, country, timezone, custom)
       VALUES ($1,$2,$3,$4,$5,$6,$7,COALESCE($8,'new'),$9,COALESCE($10,$11),
               $12,$13,$14,$15,$16,
               CASE WHEN $17::text IS NULL THEN '{}'::jsonb
                    ELSE jsonb_build_object('website', $17::text) END)
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
        defaultSource,
        a.companyKey,
        a.city,
        a.region,
        a.country,
        a.timezone,
        lead.website ?? null,
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
