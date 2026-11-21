-- Learning Loop T11: review actions (keep / pause / resume / approve a
-- challenger), their audit trail, AI challenger drafts, and the link from a new
-- experiment back to the one it replaced. Additive only.
-- Every action is tied to a review revision, carries an idempotency key and is
-- applied in one transaction (see ReviewActionsService).

ALTER TABLE "experiments" ADD COLUMN "previous_experiment_id" uuid REFERENCES "experiments"("id") ON DELETE set null;--> statement-breakpoint
ALTER TABLE "experiments" ADD COLUMN "decided_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "experiments" ADD COLUMN "decision" jsonb;--> statement-breakpoint
CREATE INDEX "experiments_previous_idx" ON "experiments" ("previous_experiment_id");--> statement-breakpoint

CREATE TABLE "review_actions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "org_id" uuid NOT NULL REFERENCES "orgs"("id") ON DELETE cascade,
  "review_id" uuid NOT NULL REFERENCES "reviews"("id") ON DELETE cascade,
  "experiment_id" uuid NOT NULL REFERENCES "experiments"("id") ON DELETE cascade,
  "revision" integer NOT NULL,
  "action_id" text NOT NULL,
  "type" text NOT NULL,
  "payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "status" text DEFAULT 'requested' NOT NULL,
  "error" text,
  "reason" text,
  "requested_by" uuid REFERENCES "users"("id") ON DELETE set null,
  "approved_by" uuid REFERENCES "users"("id") ON DELETE set null,
  "idempotency_key" text NOT NULL,
  "before" jsonb,
  "after" jsonb,
  "requested_at" timestamp with time zone DEFAULT now() NOT NULL,
  "applied_at" timestamp with time zone,
  "reverted_at" timestamp with time zone,
  "reverted_by" uuid REFERENCES "users"("id") ON DELETE set null,
  "reverts_action_id" uuid REFERENCES "review_actions"("id") ON DELETE set null,
  CONSTRAINT "review_actions_status_chk" CHECK ("status" IN ('requested','approved','applied','rejected','reverted','failed'))
);--> statement-breakpoint
CREATE UNIQUE INDEX "review_actions_idem_idx" ON "review_actions" ("org_id", "idempotency_key");--> statement-breakpoint
-- one applied row per (review, action): the second of two parallel approvals loses
CREATE UNIQUE INDEX "review_actions_one_applied_idx" ON "review_actions" ("review_id", "action_id")
  WHERE ("status" = 'applied' AND "reverts_action_id" IS NULL);--> statement-breakpoint
CREATE INDEX "review_actions_experiment_idx" ON "review_actions" ("org_id", "experiment_id", "requested_at" DESC);--> statement-breakpoint

CREATE TABLE "challenger_drafts" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "org_id" uuid NOT NULL REFERENCES "orgs"("id") ON DELETE cascade,
  "review_id" uuid NOT NULL REFERENCES "reviews"("id") ON DELETE cascade,
  "experiment_id" uuid NOT NULL REFERENCES "experiments"("id") ON DELETE cascade,
  "subject" text NOT NULL,
  "source" text DEFAULT 'template' NOT NULL,
  "created_by" uuid REFERENCES "users"("id") ON DELETE set null,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "challenger_drafts_source_chk" CHECK ("source" IN ('template','agent','gemini','mock'))
);--> statement-breakpoint
CREATE INDEX "challenger_drafts_review_idx" ON "challenger_drafts" ("org_id", "review_id", "created_at");--> statement-breakpoint

ALTER TABLE "review_actions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "review_actions" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "review_actions_tenant_isolation" ON "review_actions"
  FOR ALL
  USING ("org_id" = NULLIF(current_setting('app.current_org_id', true), '')::uuid)
  WITH CHECK ("org_id" = NULLIF(current_setting('app.current_org_id', true), '')::uuid);--> statement-breakpoint

ALTER TABLE "challenger_drafts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "challenger_drafts" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "challenger_drafts_tenant_isolation" ON "challenger_drafts"
  FOR ALL
  USING ("org_id" = NULLIF(current_setting('app.current_org_id', true), '')::uuid)
  WITH CHECK ("org_id" = NULLIF(current_setting('app.current_org_id', true), '')::uuid);--> statement-breakpoint

-- managed Postgres: owner-only bypass, same as migration 0046 / 0050 / 0055
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['review_actions', 'challenger_drafts'] LOOP
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
