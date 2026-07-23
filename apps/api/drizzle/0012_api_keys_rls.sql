-- RLS for api_keys (management endpoints run in org context). Key verification,
-- however, must resolve org FROM the key hash before any context exists — so a
-- SECURITY DEFINER function does that one controlled lookup (same pattern as
-- user_memberships in 0003). It also stamps last_used_at.

ALTER TABLE "api_keys" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "api_keys" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "api_keys_tenant_isolation" ON "api_keys"
  FOR ALL
  USING ("org_id" = NULLIF(current_setting('app.current_org_id', true), '')::uuid)
  WITH CHECK ("org_id" = NULLIF(current_setting('app.current_org_id', true), '')::uuid);--> statement-breakpoint

CREATE OR REPLACE FUNCTION verify_api_key(p_hash text)
RETURNS TABLE (id uuid, org_id uuid)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE api_keys SET last_used_at = now()
  WHERE key_hash = p_hash AND revoked_at IS NULL
  RETURNING id, org_id;
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION verify_api_key(text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION verify_api_key(text) TO supersaas_app;
