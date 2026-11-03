-- Google Sheets sync (T2.8) + the Integrations page (T9.2).

-- One row per connected integration per workspace. Secrets in config are
-- AES-256-GCM encrypted (refreshTokenEnc), like sender credentials.
CREATE TABLE "integrations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "org_id" uuid NOT NULL REFERENCES "orgs"("id") ON DELETE cascade,
  "provider" text NOT NULL,
  "account_email" text,
  "config" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "connected_by" uuid REFERENCES "users"("id") ON DELETE set null,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "integrations_provider_check" CHECK ("provider" IN ('google_sheets'))
);--> statement-breakpoint
CREATE UNIQUE INDEX "integrations_org_provider_idx" ON "integrations" ("org_id", "provider");--> statement-breakpoint
ALTER TABLE "integrations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "integrations" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "integrations_tenant_isolation" ON "integrations"
  FOR ALL
  USING ("org_id" = NULLIF(current_setting('app.current_org_id', true), '')::uuid)
  WITH CHECK ("org_id" = NULLIF(current_setting('app.current_org_id', true), '')::uuid);--> statement-breakpoint

-- A sheet tab imported into leads, re-synced hourly while enabled. Each run
-- goes through the normal import pipeline (dedupe by email, plan limits) and
-- is recorded as an import_jobs row (last_job_id).
CREATE TABLE "sheet_syncs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "org_id" uuid NOT NULL REFERENCES "orgs"("id") ON DELETE cascade,
  "spreadsheet_id" text NOT NULL,
  "spreadsheet_title" text NOT NULL,
  "sheet_title" text NOT NULL,
  "mapping" jsonb NOT NULL,
  "on_duplicate" text DEFAULT 'update' NOT NULL,
  "enabled" boolean DEFAULT true NOT NULL,
  "last_synced_at" timestamp with time zone,
  "last_status" text,
  "last_error" text,
  "last_job_id" uuid,
  "created_by" uuid REFERENCES "users"("id") ON DELETE set null,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "sheet_syncs_on_duplicate_check" CHECK ("on_duplicate" IN ('skip', 'update')),
  CONSTRAINT "sheet_syncs_status_check" CHECK ("last_status" IS NULL OR "last_status" IN ('ok', 'error'))
);--> statement-breakpoint
CREATE UNIQUE INDEX "sheet_syncs_org_sheet_idx" ON "sheet_syncs" ("org_id", "spreadsheet_id", "sheet_title");--> statement-breakpoint
ALTER TABLE "sheet_syncs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "sheet_syncs" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "sheet_syncs_tenant_isolation" ON "sheet_syncs"
  FOR ALL
  USING ("org_id" = NULLIF(current_setting('app.current_org_id', true), '')::uuid)
  WITH CHECK ("org_id" = NULLIF(current_setting('app.current_org_id', true), '')::uuid);--> statement-breakpoint

-- The hourly sync job's one cross-tenant read: which enabled syncs are due.
CREATE OR REPLACE FUNCTION due_sheet_syncs(p_every interval)
RETURNS TABLE (id uuid, org_id uuid)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT s.id, s.org_id FROM sheet_syncs s
  WHERE s.enabled AND (s.last_synced_at IS NULL OR s.last_synced_at <= now() - p_every)
  ORDER BY s.last_synced_at NULLS FIRST
  LIMIT 200;
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION due_sheet_syncs(interval) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION due_sheet_syncs(interval) TO supersaas_app;
