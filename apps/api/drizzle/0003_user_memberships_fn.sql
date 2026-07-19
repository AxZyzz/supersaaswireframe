-- Login needs the list of orgs a user belongs to BEFORE any org context exists,
-- which RLS forbids for the app role. This SECURITY DEFINER function (owned by
-- the migration/owner role, which RLS-FORCE still applies to but functions
-- execute with owner rights) performs that one controlled cross-tenant read.
-- Scope is deliberately minimal: memberships + org names for ONE user id.

CREATE OR REPLACE FUNCTION user_memberships(p_user_id uuid)
RETURNS TABLE (org_id uuid, org_name text, role "role")
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT m.org_id, o.name AS org_name, m.role
  FROM memberships m
  JOIN orgs o ON o.id = m.org_id
  WHERE m.user_id = p_user_id
  ORDER BY m.created_at;
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION user_memberships(uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION user_memberships(uuid) TO supersaas_app;
