-- Learning Loop T03: every result that matters (qualified reply, booked call,
-- reply, bounce, unsubscribe, complaint) becomes an idempotent outcome event
-- linked to its enrollment, company and experiment variant. AI labels start
-- "provisional" until a person verifies them. Corrections never update a row:
-- they insert a new row with supersedes_id, and v_outcomes_current shows the
-- latest one. Additive only.
CREATE TABLE "outcome_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "org_id" uuid NOT NULL REFERENCES "orgs"("id") ON DELETE cascade,
  "campaign_lead_id" uuid REFERENCES "campaign_leads"("id") ON DELETE set null,
  "lead_id" uuid REFERENCES "leads"("id") ON DELETE set null,
  "company_key" text,
  "experiment_id" uuid REFERENCES "experiments"("id") ON DELETE set null,
  "variant_id" uuid REFERENCES "experiment_variants"("id") ON DELETE set null,
  "conversation_id" uuid REFERENCES "conversations"("id") ON DELETE set null,
  "sent_email_id" uuid REFERENCES "sent_emails"("id") ON DELETE set null,
  "type" text NOT NULL,
  "source" text NOT NULL,
  "verification" text NOT NULL,
  "occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "created_by" uuid REFERENCES "users"("id") ON DELETE set null,
  "verified_by" uuid REFERENCES "users"("id") ON DELETE set null,
  "verified_at" timestamp with time zone,
  "reason" text,
  "supersedes_id" uuid REFERENCES "outcome_events"("id") ON DELETE set null,
  "idempotency_key" text NOT NULL,
  CONSTRAINT "outcome_events_type_chk" CHECK ("type" IN
    ('qualified_reply','booked_call','reply','bounce','unsubscribe','complaint')),
  CONSTRAINT "outcome_events_source_chk" CHECK ("source" IN
    ('inbox_ai','manual','gmail_sync','system','crm','calendar')),
  CONSTRAINT "outcome_events_verification_chk" CHECK ("verification" IN
    ('provisional','verified','rejected'))
);--> statement-breakpoint
CREATE UNIQUE INDEX "outcome_events_idem_idx" ON "outcome_events" ("org_id", "idempotency_key");--> statement-breakpoint
CREATE INDEX "outcome_events_exp_type_idx" ON "outcome_events" ("org_id", "experiment_id", "type");--> statement-breakpoint
CREATE INDEX "outcome_events_company_idx" ON "outcome_events" ("org_id", "company_key");--> statement-breakpoint
CREATE INDEX "outcome_events_cl_type_idx" ON "outcome_events" ("org_id", "campaign_lead_id", "type");--> statement-breakpoint
CREATE INDEX "outcome_events_supersedes_idx" ON "outcome_events" ("supersedes_id");--> statement-breakpoint
CREATE INDEX "outcome_events_conv_idx" ON "outcome_events" ("conversation_id");--> statement-breakpoint

ALTER TABLE "outcome_events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "outcome_events" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "outcome_events_tenant_isolation" ON "outcome_events"
  FOR ALL
  USING ("org_id" = NULLIF(current_setting('app.current_org_id', true), '')::uuid)
  WITH CHECK ("org_id" = NULLIF(current_setting('app.current_org_id', true), '')::uuid);--> statement-breakpoint
-- managed Postgres: owner-only bypass, same as migration 0046
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['outcome_events'] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_policies
      WHERE schemaname = 'public' AND tablename = t AND policyname = 'owner_bypass'
    ) THEN
      EXECUTE format(
        'CREATE POLICY owner_bypass ON %I FOR ALL TO %I USING (true) WITH CHECK (true)',
        t, current_user);
    END IF;
  END LOOP;
END $$;--> statement-breakpoint

-- The current picture: rows nobody has superseded, and per enrollment + type
-- only the latest one (a reply thread may legitimately have several replies,
-- but a qualified_reply / booked_call has one current verdict per enrollment).
-- security_invoker so the caller's tenant RLS applies, not the owner's bypass.
CREATE VIEW "v_outcomes_current" WITH (security_invoker = true) AS
SELECT DISTINCT ON (
  COALESCE(o."campaign_lead_id"::text, o."id"::text),
  o."type",
  CASE WHEN o."type" = 'reply' THEN o."id"::text ELSE '' END
) o.*
FROM "outcome_events" o
WHERE NOT EXISTS (
  SELECT 1 FROM "outcome_events" s WHERE s."supersedes_id" = o."id"
)
ORDER BY
  COALESCE(o."campaign_lead_id"::text, o."id"::text),
  o."type",
  CASE WHEN o."type" = 'reply' THEN o."id"::text ELSE '' END,
  o."occurred_at" DESC, o."created_at" DESC;--> statement-breakpoint

-- Per-workspace qualification rubric: what counts as a "qualified" reply.
ALTER TABLE "org_knowledge" ADD COLUMN "qualification_rubric" text;
