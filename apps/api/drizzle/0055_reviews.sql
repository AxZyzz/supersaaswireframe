-- Learning Loop T05: one row per Review revision of an experiment. The policy
-- (T04, pure code) turns counts into a decision; this table keeps what it was
-- given (inputs), what it said (result), and the plain-words explanation, so
-- every number on screen can be traced back to a revision. Additive only.
-- Simulated reviews ("Try simulation") are stored with simulated = true and no
-- experiment, and every query that reads real results filters them out.
CREATE TABLE "reviews" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "org_id" uuid NOT NULL REFERENCES "orgs"("id") ON DELETE cascade,
  "experiment_id" uuid REFERENCES "experiments"("id") ON DELETE cascade,
  "revision" integer DEFAULT 1 NOT NULL,
  "policy_version" text NOT NULL,
  "simulated" boolean DEFAULT false NOT NULL,
  "scenario" text,
  "inputs_hash" text NOT NULL,
  "computed_at" timestamp with time zone DEFAULT now() NOT NULL,
  "created_by" uuid REFERENCES "users"("id") ON DELETE set null,
  "inputs" jsonb NOT NULL,
  "result" jsonb NOT NULL,
  "explanation" jsonb NOT NULL,
  "explanation_source" text DEFAULT 'template' NOT NULL,
  CONSTRAINT "reviews_explanation_source_chk" CHECK ("explanation_source" IN ('template','agent','gemini')),
  CONSTRAINT "reviews_real_has_experiment_chk" CHECK ("simulated" OR "experiment_id" IS NOT NULL)
);--> statement-breakpoint
-- a real experiment has one row per revision (simulated rows have no experiment)
CREATE UNIQUE INDEX "reviews_experiment_revision_idx" ON "reviews" ("experiment_id", "revision");--> statement-breakpoint
CREATE INDEX "reviews_org_experiment_idx" ON "reviews" ("org_id", "experiment_id", "revision" DESC);--> statement-breakpoint

ALTER TABLE "reviews" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "reviews" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "reviews_tenant_isolation" ON "reviews"
  FOR ALL
  USING ("org_id" = NULLIF(current_setting('app.current_org_id', true), '')::uuid)
  WITH CHECK ("org_id" = NULLIF(current_setting('app.current_org_id', true), '')::uuid);--> statement-breakpoint
-- managed Postgres: owner-only bypass, same as migration 0046
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['reviews'] LOOP
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
