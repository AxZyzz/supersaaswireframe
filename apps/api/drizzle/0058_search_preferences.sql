-- Learning Loop T12: search preferences ("find more of who replies").
-- A manager approves a bounded test; the next Discover run reserves at most
-- 20% of its slots for one factor value (city, industry, trigger ...), for 14
-- days, reversible. Additive only; every new table carries org_id + FORCE RLS +
-- owner_bypass.

CREATE TABLE "search_preferences" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "org_id" uuid NOT NULL REFERENCES "orgs"("id") ON DELETE cascade,
  "offer_id" uuid NOT NULL REFERENCES "offers"("id") ON DELETE cascade,
  "factor" text NOT NULL,
  "value" text NOT NULL,
  "label" text NOT NULL,
  "filter" jsonb NOT NULL,
  "mode" text DEFAULT 'quota' NOT NULL,
  "cap_share" numeric(4,3) NOT NULL,
  "starts_at" timestamp with time zone DEFAULT now() NOT NULL,
  "expires_at" timestamp with time zone NOT NULL,
  "evidence" jsonb NOT NULL,
  "evidence_hash" text NOT NULL,
  "evidence_review_id" uuid REFERENCES "reviews"("id") ON DELETE set null,
  "approved_by" uuid REFERENCES "users"("id") ON DELETE set null,
  "status" text DEFAULT 'active' NOT NULL,
  "revision" integer DEFAULT 1 NOT NULL,
  "prior_profile" jsonb,
  "ended_at" timestamp with time zone,
  "ended_reason" text,
  "idempotency_key" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "search_preferences_factor_chk" CHECK ("factor" IN ('city','region','country','industry','size_band','trigger')),
  CONSTRAINT "search_preferences_mode_chk" CHECK ("mode" IN ('quota','boost')),
  CONSTRAINT "search_preferences_cap_chk" CHECK ("cap_share" > 0 AND "cap_share" <= 0.2),
  CONSTRAINT "search_preferences_status_chk" CHECK ("status" IN ('active','expired','withdrawn','reverted','deactivated'))
);--> statement-breakpoint
CREATE UNIQUE INDEX "search_preferences_idem_idx" ON "search_preferences" ("org_id", "idempotency_key");--> statement-breakpoint
-- no stacking in V1: one active preference per workspace + offer
CREATE UNIQUE INDEX "search_preferences_one_active_idx" ON "search_preferences" ("org_id", "offer_id") WHERE ("status" = 'active');--> statement-breakpoint
CREATE INDEX "search_preferences_offer_idx" ON "search_preferences" ("org_id", "offer_id", "created_at" DESC);--> statement-breakpoint

CREATE TABLE "search_preference_revisions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "org_id" uuid NOT NULL REFERENCES "orgs"("id") ON DELETE cascade,
  "preference_id" uuid NOT NULL REFERENCES "search_preferences"("id") ON DELETE cascade,
  "revision" integer NOT NULL,
  "action" text NOT NULL,
  "before" jsonb,
  "after" jsonb,
  "actor" uuid REFERENCES "users"("id") ON DELETE set null,
  "reason" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE INDEX "search_preference_revisions_idx" ON "search_preference_revisions" ("org_id", "preference_id", "created_at");--> statement-breakpoint

ALTER TABLE "prospect_runs" ADD COLUMN "preference_id" uuid REFERENCES "search_preferences"("id") ON DELETE set null;--> statement-breakpoint
ALTER TABLE "prospect_runs" ADD COLUMN "preference_revision" integer;--> statement-breakpoint
ALTER TABLE "prospect_runs" ADD COLUMN "allocation" jsonb;--> statement-breakpoint
ALTER TABLE "prospects" ADD COLUMN "via_preference" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE INDEX "prospect_runs_preference_idx" ON "prospect_runs" ("preference_id");--> statement-breakpoint

ALTER TABLE "search_preferences" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "search_preferences" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "search_preferences_tenant_isolation" ON "search_preferences"
  FOR ALL
  USING ("org_id" = NULLIF(current_setting('app.current_org_id', true), '')::uuid)
  WITH CHECK ("org_id" = NULLIF(current_setting('app.current_org_id', true), '')::uuid);--> statement-breakpoint

ALTER TABLE "search_preference_revisions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "search_preference_revisions" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "search_preference_revisions_tenant_isolation" ON "search_preference_revisions"
  FOR ALL
  USING ("org_id" = NULLIF(current_setting('app.current_org_id', true), '')::uuid)
  WITH CHECK ("org_id" = NULLIF(current_setting('app.current_org_id', true), '')::uuid);--> statement-breakpoint

-- managed Postgres: owner-only bypass, same as migration 0046 / 0050 / 0055
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['search_preferences', 'search_preference_revisions'] LOOP
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

-- Background expiry runs across every workspace, so it cannot use a tenant
-- context. These two functions are the only cross-tenant doors: one flips
-- every due preference to 'expired' (with its audit row) and returns what it
-- flipped; the other lists active ones so each can be checked per workspace.
CREATE OR REPLACE FUNCTION expire_search_preferences()
RETURNS TABLE (id uuid, org_id uuid, offer_id uuid, label text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
#variable_conflict use_column
BEGIN
  RETURN QUERY
  WITH d AS (
    UPDATE search_preferences sp
       SET status = 'expired', ended_at = now(),
           ended_reason = 'Reached its expiry date', revision = sp.revision + 1
     WHERE sp.status = 'active' AND sp.expires_at <= now()
    RETURNING sp.id, sp.org_id, sp.offer_id, sp.label, sp.revision
  ), r AS (
    INSERT INTO search_preference_revisions
      (org_id, preference_id, revision, action, before, after, reason)
    SELECT d.org_id, d.id, d.revision, 'expired',
           '{"status":"active"}'::jsonb, '{"status":"expired"}'::jsonb,
           'Reached its expiry date'
      FROM d
  )
  SELECT d.id, d.org_id, d.offer_id, d.label FROM d;
END $$;--> statement-breakpoint
CREATE OR REPLACE FUNCTION active_search_preferences()
RETURNS TABLE (id uuid, org_id uuid)
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT sp.id, sp.org_id FROM search_preferences sp WHERE sp.status = 'active'
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION expire_search_preferences() FROM PUBLIC;--> statement-breakpoint
REVOKE ALL ON FUNCTION active_search_preferences() FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION expire_search_preferences() TO supersaas_app;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION active_search_preferences() TO supersaas_app;
