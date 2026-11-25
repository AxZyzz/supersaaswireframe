-- Learning Loop T14: playbook memory. When a manager approves a result (a
-- promoted subject version, or a search preference that proved itself) the
-- team can save it as a playbook: offer + segment + what worked + evidence +
-- validity dates, with versions. Future Discover runs and challenger drafts
-- retrieve the most relevant ones as hints. Additive only; the new table
-- carries org_id + FORCE RLS + owner_bypass like every tenant table.
--
-- Editing a playbook inserts a NEW row (version + 1, supersedes_id = the old
-- row) and marks the old one 'superseded', so history is never rewritten.
-- 'retired' means a person withdrew it. Only 'active' rows are ever retrieved.
CREATE TABLE "playbooks" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "org_id" uuid NOT NULL REFERENCES "orgs"("id") ON DELETE cascade,
  "offer_id" uuid NOT NULL REFERENCES "offers"("id") ON DELETE cascade,
  "kind" text NOT NULL,
  "segment" jsonb,
  "title" text NOT NULL,
  "body" text NOT NULL,
  "evidence" jsonb NOT NULL,
  "valid_from" timestamp with time zone DEFAULT now() NOT NULL,
  "valid_to" timestamp with time zone NOT NULL,
  "version" integer DEFAULT 1 NOT NULL,
  "supersedes_id" uuid REFERENCES "playbooks"("id") ON DELETE set null,
  "status" text DEFAULT 'active' NOT NULL,
  -- where the vector copy in BigQuery stands (the text itself never leaves Postgres)
  "vector_status" text DEFAULT 'pending' NOT NULL,
  "created_by" uuid REFERENCES "users"("id") ON DELETE set null,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "retired_at" timestamp with time zone,
  "retired_by" uuid REFERENCES "users"("id") ON DELETE set null,
  CONSTRAINT "playbooks_kind_chk" CHECK ("kind" IN ('message','audience')),
  CONSTRAINT "playbooks_status_chk" CHECK ("status" IN ('active','retired','superseded')),
  CONSTRAINT "playbooks_vector_status_chk" CHECK ("vector_status" IN ('pending','indexed','failed')),
  CONSTRAINT "playbooks_title_len_chk" CHECK (char_length("title") BETWEEN 3 AND 120),
  CONSTRAINT "playbooks_body_len_chk" CHECK (char_length("body") BETWEEN 10 AND 500),
  CONSTRAINT "playbooks_valid_chk" CHECK ("valid_to" > "valid_from")
);--> statement-breakpoint
CREATE INDEX "playbooks_offer_idx" ON "playbooks" ("org_id", "offer_id", "status", "valid_to");--> statement-breakpoint
-- an edit has exactly one successor: two people editing the same version cannot both win
CREATE UNIQUE INDEX "playbooks_one_successor_idx" ON "playbooks" ("supersedes_id") WHERE ("supersedes_id" IS NOT NULL);--> statement-breakpoint
-- a double click must not save the same lesson twice
CREATE UNIQUE INDEX "playbooks_active_title_idx" ON "playbooks" ("org_id", "offer_id", lower("title")) WHERE ("status" = 'active');--> statement-breakpoint

-- which playbooks a Discover run / a challenger draft used ("Used 2 playbooks")
ALTER TABLE "prospect_runs" ADD COLUMN "playbook_ids" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "challenger_drafts" ADD COLUMN "playbook_ids" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint

ALTER TABLE "playbooks" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "playbooks" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "playbooks_tenant_isolation" ON "playbooks"
  FOR ALL
  USING ("org_id" = NULLIF(current_setting('app.current_org_id', true), '')::uuid)
  WITH CHECK ("org_id" = NULLIF(current_setting('app.current_org_id', true), '')::uuid);--> statement-breakpoint

-- managed Postgres: owner-only bypass, same as migration 0046 / 0050 / 0055 / 0058
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['playbooks'] LOOP
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
