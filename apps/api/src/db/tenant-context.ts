import type { Pool, PoolClient } from 'pg';

/**
 * Runs `fn` inside a transaction with the tenant RLS context set.
 * set_config(..., true) is transaction-local (SET LOCAL): the org id can never
 * leak to another request sharing the pooled connection.
 *
 * Every org-scoped query MUST go through this (or through the request-scoped
 * wrapper the auth layer builds on top of it). Without a context, RLS policies
 * evaluate against NULL and return/allow nothing — fail-closed by design.
 */
export async function withOrgContext<T>(
  pool: Pool,
  orgId: string,
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT set_config('app.current_org_id', $1, true)", [
      orgId,
    ]);
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
