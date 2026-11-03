import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Papa from 'papaparse';
import { Pool } from 'pg';
import { PG_POOL } from '../db/db.module';
import { withOrgContext } from '../db/tenant-context';
import { googleCreds } from '../google/google-oauth';
import {
  IMPORTABLE_FIELDS,
  type ImportableField,
} from '../leads/import/import.dto';
import { ImportService } from '../leads/import/import.service';
import {
  FetchLike,
  googleAccessToken,
} from '../senders/providers/gmail.provider';
import { IntegrationsService } from './integrations.service';

const SHEETS_API = 'https://sheets.googleapis.com/v4/spreadsheets';
const SYNC_EVERY = '1 hour';
const PREVIEW_ROWS = 5;

export interface SheetSyncRow {
  id: string;
  spreadsheet_id: string;
  spreadsheet_title: string;
  sheet_title: string;
  mapping: Record<string, ImportableField>;
  on_duplicate: 'skip' | 'update';
  enabled: boolean;
  last_synced_at: Date | null;
  last_status: 'ok' | 'error' | null;
  last_error: string | null;
  last_job_id: string | null;
  created_at: Date;
}

/** Spreadsheet id from a share link (…/spreadsheets/d/<id>/…) or a bare id. */
export function spreadsheetIdFrom(input: string): string | null {
  const s = input.trim();
  const m = /\/spreadsheets\/d\/([a-zA-Z0-9_-]{20,})/.exec(s);
  if (m) return m[1];
  return /^[a-zA-Z0-9_-]{20,}$/.test(s) ? s : null;
}

const quoteSheet = (title: string) => `'${title.replace(/'/g, "''")}'`;

/**
 * Google Sheets → leads (T2.8). Preview a sheet, save a column mapping, then
 * each sync reads the tab and runs it through the normal import pipeline
 * (dedupe by email, plan limits, activity timeline). Enabled syncs re-run
 * hourly; "Sync now" runs one on demand.
 */
@Injectable()
export class SheetsService {
  private readonly log = new Logger(SheetsService.name);
  /** Swappable in tests. */
  fetchFn: FetchLike = (input: string | URL | Request, init?: RequestInit) =>
    fetch(input, init);

  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    private readonly config: ConfigService,
    private readonly integrations: IntegrationsService,
    private readonly imports: ImportService,
  ) {}

  /** GET a Sheets API path as the workspace's connected Google account. */
  private async api<T>(orgId: string, path: string): Promise<T> {
    const account = await this.integrations.sheetsAccount(orgId);
    if (!account) {
      throw new BadRequestException(
        'Google Sheets is not connected. Connect it in Settings → Integrations.',
      );
    }
    const { clientId, clientSecret } = googleCreds(this.config);
    const token = await googleAccessToken(
      {
        refreshToken: account.refreshToken,
        clientId: clientId ?? '',
        clientSecret: clientSecret ?? '',
      },
      this.fetchFn,
      'Google Sheets access was revoked or has expired. Reconnect Google Sheets in Settings → Integrations.',
    ).catch((e: unknown) => {
      throw new BadRequestException(
        e instanceof Error ? e.message : 'Google sign-in failed.',
      );
    });
    const res = await this.fetchFn(`${SHEETS_API}/${path}`, {
      headers: { authorization: `Bearer ${token}` },
    });
    if (res.ok) return (await res.json()) as T;
    const who = account.accountEmail ?? 'the connected Google account';
    if (res.status === 403) {
      throw new BadRequestException(
        `${who} can't open that spreadsheet. Share it with ${who} (Viewer is enough), or use a sheet it owns.`,
      );
    }
    if (res.status === 404) {
      throw new BadRequestException(
        'Spreadsheet or tab not found. Check the link.',
      );
    }
    const body = (await res.json().catch(() => ({}))) as {
      error?: { message?: string };
    };
    throw new BadRequestException(
      `Google Sheets error (HTTP ${res.status}): ${body.error?.message ?? 'unknown'}`,
    );
  }

  private async meta(orgId: string, id: string) {
    const m = await this.api<{
      properties?: { title?: string };
      sheets?: { properties?: { title?: string } }[];
    }>(
      orgId,
      `${encodeURIComponent(id)}?fields=properties.title,sheets.properties.title`,
    );
    return {
      title: m.properties?.title ?? 'Untitled spreadsheet',
      sheets: (m.sheets ?? [])
        .map((s) => s.properties?.title)
        .filter((t): t is string => !!t),
    };
  }

  private async values(orgId: string, id: string, sheet: string) {
    const v = await this.api<{ values?: string[][] }>(
      orgId,
      `${encodeURIComponent(id)}/values/${encodeURIComponent(quoteSheet(sheet))}?majorDimension=ROWS`,
    );
    const rows = v.values ?? [];
    const headers = (rows[0] ?? []).map((h) => String(h).trim());
    return { headers, data: rows.slice(1) };
  }

  /** Spreadsheet title, its tabs, and the chosen tab's header + first rows. */
  async preview(orgId: string, url: string, sheet?: string) {
    const spreadsheetId = spreadsheetIdFrom(url);
    if (!spreadsheetId) {
      throw new BadRequestException(
        'That doesn’t look like a Google Sheets link. Copy it from the browser address bar.',
      );
    }
    const meta = await this.meta(orgId, spreadsheetId);
    if (!meta.sheets.length) {
      throw new BadRequestException('That spreadsheet has no tabs.');
    }
    const tab = sheet && meta.sheets.includes(sheet) ? sheet : meta.sheets[0];
    const { headers, data } = await this.values(orgId, spreadsheetId, tab);
    return {
      spreadsheetId,
      title: meta.title,
      sheets: meta.sheets,
      sheet: tab,
      headers,
      rows: data.slice(0, PREVIEW_ROWS),
      totalRows: data.length,
    };
  }

  /** Save (or update) a sync for a tab, then run it once. */
  async create(
    orgId: string,
    userId: string,
    dto: {
      spreadsheetId: string;
      sheetTitle: string;
      mapping: Record<string, ImportableField>;
      onDuplicate?: 'skip' | 'update';
      keepSyncing?: boolean;
    },
  ) {
    const mapping = Object.fromEntries(
      Object.entries(dto.mapping ?? {}).filter(
        ([col, f]) => col.trim() && IMPORTABLE_FIELDS.includes(f),
      ),
    ) as Record<string, ImportableField>;
    if (!Object.values(mapping).includes('email')) {
      throw new BadRequestException('Map one column to Email.');
    }
    const meta = await this.meta(orgId, dto.spreadsheetId);
    if (!meta.sheets.includes(dto.sheetTitle)) {
      throw new BadRequestException('That tab is not in the spreadsheet.');
    }
    const sync = await withOrgContext(this.pool, orgId, async (c) => {
      const r = await c.query<{ id: string }>(
        `INSERT INTO sheet_syncs
           (org_id, spreadsheet_id, spreadsheet_title, sheet_title, mapping,
            on_duplicate, enabled, created_by)
         VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8)
         ON CONFLICT (org_id, spreadsheet_id, sheet_title) DO UPDATE
           SET spreadsheet_title = EXCLUDED.spreadsheet_title,
               mapping = EXCLUDED.mapping, on_duplicate = EXCLUDED.on_duplicate,
               enabled = EXCLUDED.enabled, updated_at = now()
         RETURNING id`,
        [
          orgId,
          dto.spreadsheetId,
          meta.title,
          dto.sheetTitle,
          JSON.stringify(mapping),
          dto.onDuplicate ?? 'update',
          dto.keepSyncing ?? true,
          userId,
        ],
      );
      return r.rows[0];
    });
    const run = await this.run(orgId, sync.id);
    return { id: sync.id, ...run };
  }

  /**
   * Reads the tab and queues it through the import pipeline. Records the
   * outcome on the sync either way; a failure is rethrown for "Sync now".
   */
  async run(orgId: string, id: string): Promise<{ jobId: string | null }> {
    const sync = await this.get(orgId, id);
    try {
      const { headers, data } = await this.values(
        orgId,
        sync.spreadsheet_id,
        sync.sheet_title,
      );
      let jobId: string | null = null;
      if (headers.length && data.length) {
        const csv = Papa.unparse([headers, ...data]);
        const job = await this.imports.start(
          orgId,
          csv,
          sync.mapping,
          sync.on_duplicate,
          'google_sheet',
        );
        jobId = job.jobId;
      }
      await this.record(orgId, id, 'ok', null, jobId);
      return { jobId };
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Sync failed';
      await this.record(orgId, id, 'error', msg, null);
      throw err;
    }
  }

  private record(
    orgId: string,
    id: string,
    status: 'ok' | 'error',
    error: string | null,
    jobId: string | null,
  ) {
    return withOrgContext(this.pool, orgId, (c) =>
      c.query(
        `UPDATE sheet_syncs SET last_synced_at = now(), last_status = $2,
           last_error = $3, last_job_id = COALESCE($4, last_job_id), updated_at = now()
         WHERE id = $1`,
        [id, status, error, jobId],
      ),
    );
  }

  /** Hourly job: every enabled sync not run in the last hour, all workspaces. */
  async runDue(): Promise<{ ran: number; failed: number }> {
    const due = await this.pool.query<{ id: string; org_id: string }>(
      `SELECT * FROM due_sheet_syncs($1::interval)`,
      [SYNC_EVERY],
    );
    let ran = 0;
    let failed = 0;
    for (const s of due.rows) {
      try {
        await this.run(s.org_id, s.id);
        ran++;
      } catch (err) {
        failed++;
        this.log.warn(
          `sheet sync ${s.id} failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
    if (ran || failed)
      this.log.log(`sheet syncs: ${ran} ran, ${failed} failed`);
    return { ran, failed };
  }

  async get(orgId: string, id: string): Promise<SheetSyncRow> {
    const r = await withOrgContext(this.pool, orgId, (c) =>
      c.query<SheetSyncRow>(`SELECT * FROM sheet_syncs WHERE id = $1`, [id]),
    );
    if (!r.rows[0]) throw new NotFoundException('Sheet sync not found');
    return r.rows[0];
  }

  /** Syncs with the outcome of each one's latest import. */
  list(orgId: string) {
    return withOrgContext(this.pool, orgId, async (c) => {
      const r = await c.query<
        Omit<SheetSyncRow, 'last_job_id'> & {
          job_status: string | null;
          job_total: number | null;
          job_imported: number | null;
          job_updated: number | null;
          job_skipped: number | null;
        }
      >(
        `SELECT s.id, s.spreadsheet_id, s.spreadsheet_title, s.sheet_title,
                s.mapping, s.on_duplicate, s.enabled, s.last_synced_at,
                s.last_status, s.last_error, s.created_at,
                j.status AS job_status, j.total AS job_total,
                j.imported AS job_imported, j.updated AS job_updated,
                j.skipped AS job_skipped
         FROM sheet_syncs s
         LEFT JOIN import_jobs j ON j.id = s.last_job_id
         ORDER BY s.created_at DESC`,
      );
      return r.rows;
    });
  }

  async setEnabled(orgId: string, id: string, enabled: boolean) {
    await this.get(orgId, id);
    await withOrgContext(this.pool, orgId, (c) =>
      c.query(
        `UPDATE sheet_syncs SET enabled = $2, updated_at = now() WHERE id = $1`,
        [id, enabled],
      ),
    );
    return this.get(orgId, id);
  }

  /** Stops syncing; leads already imported stay. */
  async remove(orgId: string, id: string) {
    await this.get(orgId, id);
    await withOrgContext(this.pool, orgId, (c) =>
      c.query(`DELETE FROM sheet_syncs WHERE id = $1`, [id]),
    );
    return { deleted: true };
  }
}
