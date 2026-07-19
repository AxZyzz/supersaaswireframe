-- Application role: NOSUPERUSER + NOBYPASSRLS so RLS policies actually apply.
-- The compose/CI POSTGRES_USER is a superuser (bypasses RLS by definition) and
-- is used ONLY for migrations (MIGRATE_DATABASE_URL). The app and tests connect
-- as supersaas_app (DATABASE_URL). Dev password is fine here; production must
-- create this role out-of-band with a real secret before running migrations
-- (tracked in E10 deploy checklist).

DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'supersaas_app') THEN
    CREATE ROLE supersaas_app LOGIN PASSWORD 'supersaas_app' NOSUPERUSER NOBYPASSRLS;
  END IF;
END $$;--> statement-breakpoint
GRANT USAGE ON SCHEMA public TO supersaas_app;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO supersaas_app;--> statement-breakpoint
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO supersaas_app;--> statement-breakpoint
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO supersaas_app;--> statement-breakpoint
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO supersaas_app;
