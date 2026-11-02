-- E9 chunk 2: team invites. A link carries a 256-bit token; only its sha256
-- is stored. One pending invite per (org, email).
CREATE TABLE "invites" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "org_id" uuid NOT NULL REFERENCES "orgs"("id") ON DELETE cascade,
  "email" text NOT NULL,
  "role" "role" DEFAULT 'agent' NOT NULL,
  "token_hash" text NOT NULL,
  "invited_by" uuid REFERENCES "users"("id") ON DELETE set null,
  "expires_at" timestamp with time zone NOT NULL,
  "accepted_at" timestamp with time zone,
  "accepted_by" uuid REFERENCES "users"("id") ON DELETE set null,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE UNIQUE INDEX "invites_token_hash_idx" ON "invites" ("token_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "invites_pending_email_idx" ON "invites" ("org_id", lower("email"))
  WHERE "accepted_at" IS NULL;--> statement-breakpoint
CREATE INDEX "invites_org_idx" ON "invites" ("org_id");--> statement-breakpoint

ALTER TABLE "invites" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "invites" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "invites_tenant_isolation" ON "invites"
  FOR ALL
  USING ("org_id" = NULLIF(current_setting('app.current_org_id', true), '')::uuid)
  WITH CHECK ("org_id" = NULLIF(current_setting('app.current_org_id', true), '')::uuid);--> statement-breakpoint

-- Opening an invite link happens before any org context exists. This is the
-- one controlled cross-tenant read: a single invite by exact token hash, plus
-- the org name to show on the accept page. Acceptance itself then runs under
-- the resolved org's RLS context.
CREATE OR REPLACE FUNCTION resolve_invite(p_token_hash text)
RETURNS TABLE (
  id uuid,
  org_id uuid,
  org_name text,
  email text,
  role "role",
  expires_at timestamp with time zone,
  accepted_at timestamp with time zone
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT i.id, i.org_id, o.name, i.email, i.role, i.expires_at, i.accepted_at
  FROM invites i JOIN orgs o ON o.id = i.org_id
  WHERE i.token_hash = p_token_hash;
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION resolve_invite(text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION resolve_invite(text) TO supersaas_app;
