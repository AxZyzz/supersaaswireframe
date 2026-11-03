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
