-- Supabase hardening. Supabase publishes the `public` schema through its Data
-- API (PostgREST + GraphQL) and, by default, grants every table, sequence and
-- function created by "postgres" to its API roles (anon = anyone holding the
-- public anon key, authenticated, service_role). SuperSaaS never uses the Data
-- API: the NestJS API connects as supersaas_app over the pooler. Tables without
-- RLS (users, refresh_tokens, password_resets, ...) and the SECURITY DEFINER
-- functions would otherwise be reachable from the internet.
--
-- Strip every privilege those roles have in `public`, now and for objects
-- created later by the migration role (default privileges). No-op where the
-- roles don't exist (local Docker, Cloud SQL). The runtime migrator
-- (src/db/migrate.ts) re-applies this after every run, like owner_bypass.

DO $$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE ALL ON ALL TABLES IN SCHEMA public FROM %I', r);
      EXECUTE format('REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM %I', r);
      EXECUTE format('REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM %I', r);
      EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM %I', r);
      EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM %I', r);
      EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM %I', r);
      EXECUTE format('REVOKE USAGE ON SCHEMA public FROM %I', r);
    END IF;
  END LOOP;
END $$;
