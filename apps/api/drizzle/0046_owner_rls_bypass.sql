-- Managed Postgres (Cloud SQL, RDS, Neon...) has no true superuser. Locally the
-- migration role is a superuser, so it bypasses RLS and the SECURITY DEFINER
-- functions (login's user_memberships, the send scheduler's due_sends, Gmail
-- reply sync, ...) can read across tenants. On Cloud SQL the migration role
-- ("postgres") is NOT a superuser, BYPASSRLS can't be granted, and FORCE RLS
-- applies to it too: every definer function would see zero rows.
--
-- Fix: on every RLS table, one permissive policy for the migration/owner role
-- only (whoever runs this migration). supersaas_app (the role the API connects
-- as) is still bound by the tenant policies. The runtime migrator
-- (src/db/migrate.ts) re-applies this after every run so tables added later
-- get it too, and rls-owner-bypass.spec.ts fails if any RLS table lacks it.

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
END $$;
