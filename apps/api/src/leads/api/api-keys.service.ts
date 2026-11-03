import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { createHash, randomBytes } from 'crypto';
import { Pool } from 'pg';
import { PG_POOL } from '../../db/db.module';
import { withOrgContext } from '../../db/tenant-context';

export interface ApiKeyRow {
  id: string;
  name: string;
  prefix: string;
  rate_limit_per_min: number;
  created_at: Date;
  last_used_at: Date | null;
}

const COLS = 'id, name, prefix, rate_limit_per_min, created_at, last_used_at';

@Injectable()
export class ApiKeysService {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  private hash(raw: string): string {
    return createHash('sha256').update(raw).digest('hex');
  }

  async create(orgId: string, name: string, rateLimitPerMin = 120) {
    const raw = `ssk_${randomBytes(24).toString('hex')}`;
    const prefix = raw.slice(0, 12);
    const created = await withOrgContext(this.pool, orgId, async (c) => {
      const res = await c.query<ApiKeyRow>(
        `INSERT INTO api_keys (org_id, name, key_hash, prefix, rate_limit_per_min)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING ${COLS}`,
        [orgId, name.trim(), this.hash(raw), prefix, rateLimitPerMin],
      );
      return res.rows[0];
    });
    // Raw key returned exactly once — never stored, never retrievable again.
    return { ...created, key: raw };
  }

  list(orgId: string) {
    return withOrgContext(this.pool, orgId, async (c) => {
      const res = await c.query<ApiKeyRow>(
        `SELECT ${COLS}
         FROM api_keys WHERE revoked_at IS NULL ORDER BY created_at DESC`,
      );
      return res.rows;
    });
  }

  async setRateLimit(orgId: string, id: string, rateLimitPerMin: number) {
    const row = await withOrgContext(this.pool, orgId, async (c) => {
      const res = await c.query<ApiKeyRow>(
        `UPDATE api_keys SET rate_limit_per_min = $2
         WHERE id = $1 AND revoked_at IS NULL
         RETURNING ${COLS}`,
        [id, rateLimitPerMin],
      );
      return res.rows[0];
    });
    if (!row) throw new NotFoundException('API key not found');
    return row;
  }

  async revoke(orgId: string, id: string) {
    const affected = await withOrgContext(this.pool, orgId, async (c) => {
      const res = await c.query(
        `UPDATE api_keys SET revoked_at = now()
         WHERE id = $1 AND revoked_at IS NULL`,
        [id],
      );
      return res.rowCount ?? 0;
    });
    if (affected === 0) throw new NotFoundException('API key not found');
    return { revoked: true };
  }

  // Pre-context lookup by hash via the SECURITY DEFINER function; also stamps
  // last_used_at. Returns the owning org, or null if unknown/revoked.
  async verify(
    rawKey: string,
  ): Promise<{ id: string; orgId: string; rateLimit: number } | null> {
    const res = await this.pool.query<{
      id: string;
      org_id: string;
      rate_limit_per_min: number;
    }>(`SELECT id, org_id, rate_limit_per_min FROM verify_api_key($1)`, [
      this.hash(rawKey),
    ]);
    const r = res.rows[0];
    return r
      ? { id: r.id, orgId: r.org_id, rateLimit: r.rate_limit_per_min }
      : null;
  }
}
