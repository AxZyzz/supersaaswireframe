import { Pool } from 'pg';

/**
 * Managed Postgres (Cloud SQL) has no superuser, so the cross-tenant SECURITY
 * DEFINER functions only work if every RLS table carries the `owner_bypass`
 * policy for the migration role (migration 0046, re-applied by
 * src/db/migrate.ts). Locally the migration role IS a superuser, so a missing
 * policy would pass every other test and only break in production. This test
 * catches a new RLS table that was added without it.
 */
describe('RLS owner bypass (managed Postgres readiness)', () => {
  let pool: Pool;

  beforeAll(() => {
    pool = new Pool({
      connectionString:
        process.env.DATABASE_URL ??
        'postgresql://supersaas_app:supersaas_app@localhost:5432/supersaas',
    });
  });

  afterAll(() => pool.end());

  it('every RLS table has owner_bypass, granted to the owner and not the app role', async () => {
    const { rows } = await pool.query<{
      relname: string;
      owner: string;
      roles: string[] | null;
    }>(
      `SELECT c.relname, pg_get_userbyid(c.relowner) AS owner, p.roles::text[] AS roles
       FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
       LEFT JOIN pg_policies p
         ON p.schemaname = 'public' AND p.tablename = c.relname
        AND p.policyname = 'owner_bypass'
       WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relrowsecurity
       ORDER BY 1`,
    );
    expect(rows.length).toBeGreaterThan(20);
    const missing = rows.filter((r) => !r.roles).map((r) => r.relname);
    expect(missing).toEqual([]);
    for (const r of rows) {
      expect(r.roles).not.toContain('supersaas_app');
      expect(r.roles).not.toContain('public');
      expect(r.roles).toContain(r.owner);
    }
  });
});
