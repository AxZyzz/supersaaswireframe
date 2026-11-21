-- Learning Loop T13: one row per (workspace, job, period) so a scheduled job
-- that runs twice in the same period (a Cloud Scheduler retry, two API
-- instances) does its work once. Additive only; org_id + FORCE RLS +
-- owner_bypass like every workspace table.
CREATE TABLE "cron_runs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "org_id" uuid NOT NULL REFERENCES "orgs"("id") ON DELETE cascade,
  "job" text NOT NULL,
  "period" text NOT NULL,
  "ran_at" timestamp with time zone DEFAULT now() NOT NULL,
  "result" jsonb
);--> statement-breakpoint
CREATE UNIQUE INDEX "cron_runs_org_job_period_idx" ON "cron_runs" ("org_id", "job", "period");--> statement-breakpoint

ALTER TABLE "cron_runs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "cron_runs" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "cron_runs_tenant_isolation" ON "cron_runs"
  FOR ALL
  USING ("org_id" = NULLIF(current_setting('app.current_org_id', true), '')::uuid)
  WITH CHECK ("org_id" = NULLIF(current_setting('app.current_org_id', true), '')::uuid);--> statement-breakpoint

-- managed Postgres: owner-only bypass, same as migration 0046 / 0050 / 0055
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'cron_runs' AND policyname = 'owner_bypass'
  ) THEN
    EXECUTE format(
      'CREATE POLICY owner_bypass ON cron_runs FOR ALL TO %I USING (true) WITH CHECK (true)',
      current_user);
  END IF;
END $$;--> statement-breakpoint

-- The scheduled jobs run across every workspace, so they cannot start in a
-- tenant context. This is the one cross-tenant door they need: the workspaces
-- that have a running experiment or an active search preference.
CREATE OR REPLACE FUNCTION loop_workspaces()
RETURNS TABLE (org_id uuid)
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT e.org_id FROM experiments e WHERE e.status = 'running'
  UNION
  SELECT sp.org_id FROM search_preferences sp WHERE sp.status = 'active'
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION loop_workspaces() FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION loop_workspaces() TO supersaas_app;
