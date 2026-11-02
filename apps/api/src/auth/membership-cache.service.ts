import { Inject, Injectable } from '@nestjs/common';
import { Pool } from 'pg';
import { PG_POOL } from '../db/db.module';
import type { Role } from './types';

const TTL_MS = 30_000;
const MAX_ENTRIES = 10_000;

/**
 * Live membership check for every authenticated request. Access tokens are
 * stateless and carry the role they were minted with, so without this a
 * removed member keeps access (and a demoted admin keeps admin) until the
 * token expires. Short TTL bounds staleness across instances; same-process
 * changes call invalidate() and apply immediately.
 */
@Injectable()
export class MembershipCache {
  private readonly entries = new Map<
    string,
    { role: Role | null; at: number }
  >();

  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  async role(userId: string, orgId: string): Promise<Role | null> {
    const key = `${userId}:${orgId}`;
    const hit = this.entries.get(key);
    if (hit && Date.now() - hit.at < TTL_MS) return hit.role;

    // Pre-context lookup across the user's orgs → the SECURITY DEFINER fn.
    const r = await this.pool.query<{ role: Role }>(
      `SELECT role FROM user_memberships($1) WHERE org_id = $2`,
      [userId, orgId],
    );
    const role = r.rows[0]?.role ?? null;
    if (this.entries.size >= MAX_ENTRIES) this.entries.clear();
    this.entries.set(key, { role, at: Date.now() });
    return role;
  }

  invalidate(userId: string) {
    for (const key of this.entries.keys()) {
      if (key.startsWith(`${userId}:`)) this.entries.delete(key);
    }
  }
}
