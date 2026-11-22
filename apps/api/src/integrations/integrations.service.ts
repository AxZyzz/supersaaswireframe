import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Pool } from 'pg';
import { CryptoService } from '../crypto/crypto.service';
import { PG_POOL } from '../db/db.module';
import { withOrgContext } from '../db/tenant-context';
import { googleConfigured } from '../google/google-oauth';

interface SheetsConfig {
  refreshTokenEnc: string;
  scope: string;
}

/** Stored in integrations.config for provider google_calendar. */
interface CalendarConfig {
  refreshTokenEnc: string;
  scope: string;
  /** Start of the last good sync (ISO): the next sync reads events changed since. */
  lastSyncedAt?: string | null;
  lastStatus?: 'ok' | 'error' | null;
  lastError?: string | null;
  /** The refresh token was revoked or expired: the sync stops until reconnected. */
  needsReconnect?: boolean;
}

/**
 * Connected third-party accounts per workspace (T9.2): today Google Sheets;
 * Gmail lives on sender accounts, SES waits on AWS. Secrets are encrypted at
 * rest and never leave this service.
 */
@Injectable()
export class IntegrationsService {
  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    private readonly crypto: CryptoService,
    private readonly config: ConfigService,
  ) {}

  /** What the Integrations page shows. */
  overview(orgId: string) {
    const google = googleConfigured(this.config);
    return withOrgContext(this.pool, orgId, async (c) => {
      const gmail = await c.query<{ total: number; verified: number }>(
        `SELECT count(*)::int AS total,
                count(*) FILTER (WHERE status = 'verified')::int AS verified
         FROM sender_accounts WHERE provider = 'gmail'`,
      );
      const sheets = await c.query<{
        account_email: string | null;
        created_at: Date;
      }>(
        `SELECT account_email, created_at FROM integrations WHERE provider = 'google_sheets'`,
      );
      const syncs = await c.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM sheet_syncs`,
      );
      const cal = await c.query<{
        account_email: string | null;
        created_at: Date;
        config: CalendarConfig;
      }>(
        `SELECT account_email, created_at, config FROM integrations WHERE provider = 'google_calendar'`,
      );
      const booked = await c.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM v_outcomes_current
          WHERE source = 'calendar' AND type = 'booked_call' AND verification = 'verified'`,
      );
      const k = cal.rows[0];
      const s = sheets.rows[0];
      return {
        gmail: {
          available: google,
          senders: gmail.rows[0].total,
          verified: gmail.rows[0].verified,
        },
        googleSheets: {
          available: google,
          connected: !!s,
          accountEmail: s?.account_email ?? null,
          connectedAt: s?.created_at ?? null,
          syncs: syncs.rows[0].n,
        },
        googleCalendar: {
          available: google,
          connected: !!k,
          accountEmail: k?.account_email ?? null,
          connectedAt: k?.created_at ?? null,
          lastSyncedAt: k?.config?.lastSyncedAt ?? null,
          lastStatus: k?.config?.lastStatus ?? null,
          lastError: k?.config?.lastError ?? null,
          needsReconnect: !!k?.config?.needsReconnect,
          bookedCalls: booked.rows[0].n,
        },
        ses: { available: false },
      };
    });
  }

  saveSheets(
    orgId: string,
    userId: string,
    input: { email: string; refreshToken: string; scope: string },
  ) {
    const config: SheetsConfig = {
      refreshTokenEnc: this.crypto.encrypt(input.refreshToken),
      scope: input.scope,
    };
    return withOrgContext(this.pool, orgId, async (c) => {
      const r = await c.query<{ reconnected: boolean }>(
        `INSERT INTO integrations (org_id, provider, account_email, config, connected_by)
         VALUES ($1, 'google_sheets', $2, $3::jsonb, $4)
         ON CONFLICT (org_id, provider) DO UPDATE
           SET account_email = EXCLUDED.account_email, config = EXCLUDED.config,
               connected_by = EXCLUDED.connected_by, updated_at = now()
         RETURNING (xmax <> 0) AS reconnected`,
        [orgId, input.email, JSON.stringify(config), userId],
      );
      return { reconnected: r.rows[0].reconnected };
    });
  }

  /** Decrypted Sheets credentials, or null when not connected. */
  async sheetsAccount(
    orgId: string,
  ): Promise<{ refreshToken: string; accountEmail: string | null } | null> {
    const r = await withOrgContext(this.pool, orgId, (c) =>
      c.query<{ account_email: string | null; config: SheetsConfig }>(
        `SELECT account_email, config FROM integrations WHERE provider = 'google_sheets'`,
      ),
    );
    const row = r.rows[0];
    if (!row?.config?.refreshTokenEnc) return null;
    return {
      refreshToken: this.crypto.decrypt(row.config.refreshTokenEnc),
      accountEmail: row.account_email,
    };
  }

  // ── Google Calendar (T16) ────────────────────────────────────────────────

  /** Connect (or reconnect) the calendar. The sync cursor starts over. */
  saveCalendar(
    orgId: string,
    userId: string,
    input: { email: string; refreshToken: string; scope: string },
  ) {
    const config: CalendarConfig = {
      refreshTokenEnc: this.crypto.encrypt(input.refreshToken),
      scope: input.scope,
      lastSyncedAt: null,
      lastStatus: null,
      lastError: null,
      needsReconnect: false,
    };
    return withOrgContext(this.pool, orgId, async (c) => {
      const r = await c.query<{ reconnected: boolean }>(
        `INSERT INTO integrations (org_id, provider, account_email, config, connected_by)
         VALUES ($1, 'google_calendar', $2, $3::jsonb, $4)
         ON CONFLICT (org_id, provider) DO UPDATE
           SET account_email = EXCLUDED.account_email, config = EXCLUDED.config,
               connected_by = EXCLUDED.connected_by, updated_at = now()
         RETURNING (xmax <> 0) AS reconnected`,
        [orgId, input.email, JSON.stringify(config), userId],
      );
      return { reconnected: r.rows[0].reconnected };
    });
  }

  /** Decrypted calendar credentials and cursor, or null when not connected. */
  async calendarAccount(orgId: string): Promise<{
    refreshToken: string;
    accountEmail: string;
    lastSyncedAt: string | null;
  } | null> {
    const r = await withOrgContext(this.pool, orgId, (c) =>
      c.query<{ account_email: string | null; config: CalendarConfig }>(
        `SELECT account_email, config FROM integrations WHERE provider = 'google_calendar'`,
      ),
    );
    const row = r.rows[0];
    if (!row?.config?.refreshTokenEnc || !row.account_email) return null;
    return {
      refreshToken: this.crypto.decrypt(row.config.refreshTokenEnc),
      accountEmail: row.account_email,
      lastSyncedAt: row.config.lastSyncedAt ?? null,
    };
  }

  /**
   * Record how the last sync went. A good sync moves the cursor to when it
   * STARTED (so events changed while it ran are read again next time); a bad
   * one leaves the cursor where it was.
   */
  markCalendarSync(
    orgId: string,
    r: {
      ok: boolean;
      startedAt: Date;
      error?: string | null;
      needsReconnect?: boolean;
    },
  ) {
    const patch: Partial<CalendarConfig> = r.ok
      ? {
          lastSyncedAt: r.startedAt.toISOString(),
          lastStatus: 'ok',
          lastError: null,
        }
      : {
          lastStatus: 'error',
          lastError: (r.error ?? 'Sync failed').slice(0, 300),
          ...(r.needsReconnect ? { needsReconnect: true } : {}),
        };
    return withOrgContext(this.pool, orgId, (c) =>
      c.query(
        `UPDATE integrations SET config = config || $1::jsonb, updated_at = now()
          WHERE provider = 'google_calendar'`,
        [JSON.stringify(patch)],
      ),
    );
  }

  /** Forget the calendar. Outcomes already recorded stay (they are history). */
  disconnectCalendar(orgId: string) {
    return withOrgContext(this.pool, orgId, async (c) => {
      await c.query(
        `DELETE FROM integrations WHERE provider = 'google_calendar'`,
      );
      return { disconnected: true };
    });
  }

  /** Forget the Google account and pause its syncs (they can't run anyway). */
  disconnectSheets(orgId: string) {
    return withOrgContext(this.pool, orgId, async (c) => {
      await c.query(
        `DELETE FROM integrations WHERE provider = 'google_sheets'`,
      );
      await c.query(
        `UPDATE sheet_syncs SET enabled = false, updated_at = now() WHERE enabled`,
      );
      return { disconnected: true };
    });
  }
}
