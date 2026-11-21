-- Expelly prospect discovery: a goal becomes an ideal customer profile, Gemini
-- proposes candidate companies, and each one is checked on its own live
-- website. Only what the pages show is kept (facts with quotes + source URLs,
-- emails that literally appear on the site). Both tables are tenant-scoped
-- like every other workspace table.
CREATE TABLE "prospect_runs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "org_id" uuid NOT NULL REFERENCES "orgs"("id") ON DELETE cascade,
  "created_by" uuid REFERENCES "users"("id") ON DELETE set null,
  "goal" text NOT NULL,
  "icp" jsonb,
  "status" text DEFAULT 'queued' NOT NULL,
  "requested" integer DEFAULT 0 NOT NULL,
  "total" integer DEFAULT 0 NOT NULL,
  "done" integer DEFAULT 0 NOT NULL,
  "verified" integer DEFAULT 0 NOT NULL,
  "error" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "finished_at" timestamp with time zone
);--> statement-breakpoint
CREATE INDEX "prospect_runs_org_idx" ON "prospect_runs" ("org_id", "created_at");--> statement-breakpoint
CREATE TABLE "prospects" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "org_id" uuid NOT NULL REFERENCES "orgs"("id") ON DELETE cascade,
  "run_id" uuid NOT NULL REFERENCES "prospect_runs"("id") ON DELETE cascade,
  "company_name" text NOT NULL,
  "domain" text NOT NULL,
  "website_url" text,
  "reason" text,
  "status" text DEFAULT 'pending' NOT NULL,
  "summary" text,
  "industry" text,
  "location" text,
  "fit_score" integer,
  "stars" integer,
  "score_parts" jsonb,
  "evidence" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "opportunity" jsonb,
  "unknowns" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "emails" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "pages" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "error" text,
  "lead_id" uuid REFERENCES "leads"("id") ON DELETE set null,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE UNIQUE INDEX "prospects_run_domain_idx" ON "prospects" ("run_id", "domain");--> statement-breakpoint
CREATE INDEX "prospects_org_idx" ON "prospects" ("org_id", "created_at");--> statement-breakpoint
ALTER TABLE "prospect_runs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "prospect_runs" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "prospect_runs_tenant_isolation" ON "prospect_runs"
  FOR ALL
  USING ("org_id" = NULLIF(current_setting('app.current_org_id', true), '')::uuid)
  WITH CHECK ("org_id" = NULLIF(current_setting('app.current_org_id', true), '')::uuid);--> statement-breakpoint
ALTER TABLE "prospects" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "prospects" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "prospects_tenant_isolation" ON "prospects"
  FOR ALL
  USING ("org_id" = NULLIF(current_setting('app.current_org_id', true), '')::uuid)
  WITH CHECK ("org_id" = NULLIF(current_setting('app.current_org_id', true), '')::uuid);--> statement-breakpoint
-- managed Postgres: owner-only bypass, same as migration 0046
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['prospect_runs', 'prospects'] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_policies
      WHERE schemaname = 'public' AND tablename = t AND policyname = 'owner_bypass'
    ) THEN
      EXECUTE format(
        'CREATE POLICY owner_bypass ON %I FOR ALL TO %I USING (true) WITH CHECK (true)',
        t, current_user);
    END IF;
  END LOOP;
END $$;
