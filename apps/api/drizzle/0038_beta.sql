-- T10.7 beta launch: waitlist (platform-level, not tenant data) + in-app feedback.

CREATE TABLE "waitlist" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "email" text NOT NULL,
  "name" text,
  "company" text,
  "use_case" text,
  "status" text DEFAULT 'pending' NOT NULL,   -- pending | approved | joined
  "invite_code_hash" text,                     -- sha256 of the code in the signup link
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "approved_at" timestamp with time zone,
  "joined_at" timestamp with time zone,
  CONSTRAINT "waitlist_status_check" CHECK ("status" IN ('pending', 'approved', 'joined'))
);--> statement-breakpoint
CREATE UNIQUE INDEX "waitlist_email_idx" ON "waitlist" (lower("email"));--> statement-breakpoint
CREATE UNIQUE INDEX "waitlist_code_idx" ON "waitlist" ("invite_code_hash");--> statement-breakpoint

CREATE TABLE "feedback" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "org_id" uuid NOT NULL REFERENCES "orgs"("id") ON DELETE cascade,
  "user_id" uuid REFERENCES "users"("id") ON DELETE set null,
  "kind" text DEFAULT 'other' NOT NULL,
  "message" text NOT NULL,
  "page" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "feedback_kind_check" CHECK ("kind" IN ('bug', 'idea', 'other'))
);--> statement-breakpoint
CREATE INDEX "feedback_org_idx" ON "feedback" ("org_id", "created_at");--> statement-breakpoint
ALTER TABLE "feedback" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "feedback" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "feedback_tenant_isolation" ON "feedback"
  FOR ALL
  USING ("org_id" = NULLIF(current_setting('app.current_org_id', true), '')::uuid)
  WITH CHECK ("org_id" = NULLIF(current_setting('app.current_org_id', true), '')::uuid);--> statement-breakpoint

-- Operator console reads feedback across workspaces (with author + workspace names).
CREATE OR REPLACE FUNCTION operator_feedback(p_limit int)
RETURNS TABLE (id uuid, kind text, message text, page text, created_at timestamptz,
               org_name text, user_name text, user_email text)
LANGUAGE sql SECURITY DEFINER SET search_path = public STABLE
AS $$
  SELECT f.id, f.kind, f.message, f.page, f.created_at, o.name, u.name, u.email
  FROM feedback f
  JOIN orgs o ON o.id = f.org_id
  LEFT JOIN users u ON u.id = f.user_id
  ORDER BY f.created_at DESC
  LIMIT p_limit;
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION operator_feedback(int) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION operator_feedback(int) TO supersaas_app;
