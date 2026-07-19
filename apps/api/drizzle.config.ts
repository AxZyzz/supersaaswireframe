import 'dotenv/config';
import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema: './src/db/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    // Migrations run as the superuser/owner role; the app itself connects with
    // the restricted supersaas_app role (DATABASE_URL) so RLS applies.
    url:
      process.env.MIGRATE_DATABASE_URL ??
      'postgresql://supersaas:supersaas@localhost:5432/supersaas',
  },
});
