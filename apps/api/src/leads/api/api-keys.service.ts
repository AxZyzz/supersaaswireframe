import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { createHash, randomBytes } from 'crypto';
import { Pool } from 'pg';
import { PG_POOL } from '../../db/db.module';
import { withOrgContext } from '../../db/tenant-context';

export interface ApiKeyRow {
  id: string;
  name: string;
  prefix: string;
  created_at: Date;
  last_used_at: Date | null;
}

@Injectable()
export class ApiKeysService {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  private hash(raw: string): string {
    return createHash('sha256').update(raw).digest('hex');
  }

  async create(orgId: string, name: string) {
    const raw = `ssk_${randomBytes(24).toString('hex')}`;
    const prefix = raw.slice(0, 12);
    const created = await withOrgContext(this.pool, orgId, async (c) => {
      const res = await c.query<ApiKeyRow>(
        `INSERT INTO api_keys (org_id, name, key_hash, prefix)
         VALUES ($1, $2, $3, $4)
         RETURNING id, name, prefix, created_at, last_used_at`,
        [orgId, name.trim(), this.hash(raw), prefix],
      );
      return res.rows[0];
    });
    // Raw key returned exactly once — never stored, never retrievable again.
    return { ...created, key: raw };
  }

  list(orgId: string) {
    return withOrgContext(this.pool, orgId, async (c) => {
      const res = await c.query<ApiKeyRow>(
        `SELECT id, name, prefix, created_at, last_used_at
         FROM api_keys WHERE revoked_at IS NULL ORDER BY created_at DESC`,
      );
      return res.rows;
    });
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
  async verify(rawKey: string): Promise<{ orgId: string } | null> {
    const res = await this.pool.query<{ org_id: string }>(
      `SELECT org_id FROM verify_api_key($1)`,
      [this.hash(rawKey)],
    );
    return res.rowCount && res.rowCount > 0
      ? { orgId: res.rows[0].org_id }
      : null;
  }
}
