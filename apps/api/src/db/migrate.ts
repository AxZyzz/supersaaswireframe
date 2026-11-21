/**
 * Production migrator (Cloud Run Job / any host without drizzle-kit).
 *
 *   node dist/src/db/migrate.js          (from apps/api, after `nest build`)
 *   npm run db:migrate:prod -w apps/api   (ts-node, same thing)
 *
 * Env:
 *   MIGRATE_DATABASE_URL  owner role (e.g. Cloud SQL "postgres"), required
 *   APP_DB_PASSWORD       optional: sets the restricted supersaas_app role's
 *                         password (migration 0002 creates it with a dev one)
 *   MIGRATIONS_DIR        optional, default ./drizzle
 *
 * Uses the same journal + __drizzle_migrations table as `drizzle-kit migrate`,
 * so both can be used on one database. After migrating it re-applies the
 * owner_bypass policy (migration 0046) to any RLS table that lacks it, and the
 * Supabase Data API lockdown (migration 0049; no-op off Supabase).
 */
import 'dotenv/config';
import * as fs from 'fs';
import * as path from 'path';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';

export const OWNER_BYPASS_SQL = `
DO $$
DECLARE t record;
BEGIN
  IF current_user = 'supersaas_app' THEN
    RAISE EXCEPTION 'migrations must not run as the restricted app role';
  END IF;
  FOR t IN
    SELECT c.relname
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relrowsecurity
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_policies
      WHERE schemaname = 'public' AND tablename = t.relname AND policyname = 'owner_bypass'
    ) THEN
      EXECUTE format(
        'CREATE POLICY owner_bypass ON %I FOR ALL TO %I USING (true) WITH CHECK (true)',
        t.relname, current_user);
    END IF;
  END LOOP;
END $$;`;

async function main() {
  const url = process.env.MIGRATE_DATABASE_URL;
  if (!url) throw new Error('MIGRATE_DATABASE_URL is required');
  const migrationsFolder =
    process.env.MIGRATIONS_DIR ?? path.resolve(process.cwd(), 'drizzle');

  const pool = new Pool({ connectionString: url, max: 1 });
  try {
    await migrate(drizzle(pool), { migrationsFolder });
    await pool.query(OWNER_BYPASS_SQL);
    await pool.query(
      fs.readFileSync(
        path.join(migrationsFolder, '0049_supabase_lockdown.sql'),
        'utf8',
      ),
    );

    const appPassword = process.env.APP_DB_PASSWORD;
    if (appPassword) {
      if (appPassword.length < 16) {
        throw new Error('APP_DB_PASSWORD must be at least 16 characters');
      }
      const client = await pool.connect();
      try {
        await client.query(
          `ALTER ROLE supersaas_app PASSWORD ${client.escapeLiteral(appPassword)}`,
        );
      } finally {
        client.release();
      }
      console.log('supersaas_app password set');
    }
    console.log(`migrations applied from ${migrationsFolder}`);
  } finally {
    await pool.end();
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
