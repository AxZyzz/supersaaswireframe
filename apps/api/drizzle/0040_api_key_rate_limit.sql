-- T2.9: per-key request budget for the public API (requests per minute).
ALTER TABLE api_keys ADD COLUMN rate_limit_per_min integer NOT NULL DEFAULT 120
  CHECK (rate_limit_per_min BETWEEN 1 AND 6000);--> statement-breakpoint
DROP FUNCTION IF EXISTS verify_api_key(text);--> statement-breakpoint
CREATE FUNCTION verify_api_key(p_hash text)
RETURNS TABLE (id uuid, org_id uuid, rate_limit_per_min integer)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE api_keys SET last_used_at = now()
  WHERE key_hash = p_hash AND revoked_at IS NULL
  RETURNING id, org_id, rate_limit_per_min;
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION verify_api_key(text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION verify_api_key(text) TO supersaas_app;
