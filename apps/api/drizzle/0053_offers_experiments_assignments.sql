-- Learning Loop T02: offers, enrollment snapshot, experiments, variants,
-- company-level assignments, and sent_emails experiment/variant attribution.
-- Additive only; every new table carries org_id + FORCE RLS + owner_bypass.

CREATE TABLE "offers" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "org_id" uuid NOT NULL REFERENCES "orgs"("id") ON DELETE cascade,
  "name" text NOT NULL,
  "description" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "archived_at" timestamp with time zone
);--> statement-breakpoint
CREATE INDEX "offers_org_idx" ON "offers" ("org_id", "created_at");--> statement-breakpoint

ALTER TABLE "campaigns" ADD COLUMN "offer_id" uuid REFERENCES "offers"("id") ON DELETE set null;--> statement-breakpoint
ALTER TABLE "prospect_runs" ADD COLUMN "offer_id" uuid REFERENCES "offers"("id") ON DELETE set null;--> statement-breakpoint
ALTER TABLE "campaign_leads" ADD COLUMN "snapshot" jsonb;--> statement-breakpoint

CREATE TABLE "experiments" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "org_id" uuid NOT NULL REFERENCES "orgs"("id") ON DELETE cascade,
  "campaign_id" uuid NOT NULL REFERENCES "campaigns"("id") ON DELETE cascade,
  "step_id" uuid NOT NULL REFERENCES "campaign_steps"("id") ON DELETE cascade,
  "kind" text DEFAULT 'subject' NOT NULL,
  "status" text DEFAULT 'draft' NOT NULL,
  "unit" text DEFAULT 'company' NOT NULL,
  "primary_metric" text DEFAULT 'qualified_reply' NOT NULL,
  "secondary_metric" text DEFAULT 'booked_call' NOT NULL,
  "baseline_rate" real DEFAULT 0.03 NOT NULL,
  "min_lift_pp" real DEFAULT 2 NOT NULL,
  "target_n_per_arm" integer,
  "response_window_days" integer DEFAULT 14 NOT NULL,
  "decision_date" timestamp with time zone,
  "guardrails" jsonb DEFAULT '{"bounce":0.05,"unsubscribe":0.02,"complaint":0.003}'::jsonb NOT NULL,
  "allocation" jsonb DEFAULT '{"weights":[0.5,0.5]}'::jsonb NOT NULL,
  "policy_version" text DEFAULT 'v1' NOT NULL,
  "offer_ref" uuid REFERENCES "offers"("id") ON DELETE set null,
  "created_by" uuid REFERENCES "users"("id") ON DELETE set null,
  "started_at" timestamp with time zone,
  "stopped_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE INDEX "experiments_org_campaign_idx" ON "experiments" ("org_id", "campaign_id", "created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "experiments_running_step_idx" ON "experiments" ("campaign_id", "step_id") WHERE ("status" = 'running');--> statement-breakpoint

CREATE TABLE "experiment_variants" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "org_id" uuid NOT NULL REFERENCES "orgs"("id") ON DELETE cascade,
  "experiment_id" uuid NOT NULL REFERENCES "experiments"("id") ON DELETE cascade,
  "label" text NOT NULL,
  "subject" text NOT NULL,
  "template_id" uuid REFERENCES "templates"("id") ON DELETE set null,
  "template_version" integer DEFAULT 1 NOT NULL,
  "is_control" boolean DEFAULT false NOT NULL,
  "status" text DEFAULT 'active' NOT NULL,
  "created_by" uuid REFERENCES "users"("id") ON DELETE set null,
  "approved_by" uuid REFERENCES "users"("id") ON DELETE set null,
  "approved_at" timestamp with time zone,
  "paused_by" uuid REFERENCES "users"("id") ON DELETE set null,
  "paused_at" timestamp with time zone,
  "pause_reason" text,
  "resumed_by" uuid REFERENCES "users"("id") ON DELETE set null,
  "resumed_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE INDEX "experiment_variants_experiment_idx" ON "experiment_variants" ("experiment_id", "created_at");--> statement-breakpoint

CREATE TABLE "experiment_assignments" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "org_id" uuid NOT NULL REFERENCES "orgs"("id") ON DELETE cascade,
  "experiment_id" uuid NOT NULL REFERENCES "experiments"("id") ON DELETE cascade,
  "company_key" text NOT NULL,
  "variant_id" uuid NOT NULL REFERENCES "experiment_variants"("id") ON DELETE restrict,
  "assigned_at" timestamp with time zone DEFAULT now() NOT NULL,
  "hash" text NOT NULL,
  "reassigned_from" uuid REFERENCES "experiment_variants"("id") ON DELETE set null
);--> statement-breakpoint
CREATE UNIQUE INDEX "experiment_assignments_exp_company_idx" ON "experiment_assignments" ("experiment_id", "company_key");--> statement-breakpoint
CREATE INDEX "experiment_assignments_org_idx" ON "experiment_assignments" ("org_id", "experiment_id");--> statement-breakpoint

ALTER TABLE "sent_emails" ADD COLUMN "experiment_id" uuid REFERENCES "experiments"("id") ON DELETE set null;--> statement-breakpoint
ALTER TABLE "sent_emails" ADD COLUMN "variant_id" uuid REFERENCES "experiment_variants"("id") ON DELETE set null;--> statement-breakpoint
CREATE INDEX "sent_emails_experiment_idx" ON "sent_emails" ("experiment_id", "variant_id");--> statement-breakpoint

ALTER TABLE "offers" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "offers" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "offers_tenant_isolation" ON "offers"
  FOR ALL
  USING ("org_id" = NULLIF(current_setting('app.current_org_id', true), '')::uuid)
  WITH CHECK ("org_id" = NULLIF(current_setting('app.current_org_id', true), '')::uuid);--> statement-breakpoint

ALTER TABLE "experiments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "experiments" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "experiments_tenant_isolation" ON "experiments"
  FOR ALL
  USING ("org_id" = NULLIF(current_setting('app.current_org_id', true), '')::uuid)
  WITH CHECK ("org_id" = NULLIF(current_setting('app.current_org_id', true), '')::uuid);--> statement-breakpoint

ALTER TABLE "experiment_variants" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "experiment_variants" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "experiment_variants_tenant_isolation" ON "experiment_variants"
  FOR ALL
  USING ("org_id" = NULLIF(current_setting('app.current_org_id', true), '')::uuid)
  WITH CHECK ("org_id" = NULLIF(current_setting('app.current_org_id', true), '')::uuid);--> statement-breakpoint

ALTER TABLE "experiment_assignments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "experiment_assignments" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "experiment_assignments_tenant_isolation" ON "experiment_assignments"
  FOR ALL
  USING ("org_id" = NULLIF(current_setting('app.current_org_id', true), '')::uuid)
  WITH CHECK ("org_id" = NULLIF(current_setting('app.current_org_id', true), '')::uuid);--> statement-breakpoint

-- managed Postgres: owner-only bypass, same as migration 0046 / 0050
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['offers', 'experiments', 'experiment_variants', 'experiment_assignments'] LOOP
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
