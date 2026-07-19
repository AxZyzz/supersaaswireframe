-- Row-Level Security: tenant isolation for org-scoped tables.
-- Context is set per-transaction via set_config('app.current_org_id', $org, true)
-- (see src/db/tenant-context.ts). current_setting(..., true) returns NULL when
-- unset, so with no context every policy evaluates false: fail closed.
-- FORCE ensures policies apply even to the table owner (dev connects as owner).
-- users and refresh_tokens stay global: auth must look up by email before any
-- org context exists.

ALTER TABLE "orgs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "orgs" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "orgs_tenant_isolation" ON "orgs"
  FOR ALL
  USING ("id" = NULLIF(current_setting('app.current_org_id', true), '')::uuid)
  WITH CHECK ("id" = NULLIF(current_setting('app.current_org_id', true), '')::uuid);--> statement-breakpoint

ALTER TABLE "memberships" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "memberships" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "memberships_tenant_isolation" ON "memberships"
  FOR ALL
  USING ("org_id" = NULLIF(current_setting('app.current_org_id', true), '')::uuid)
  WITH CHECK ("org_id" = NULLIF(current_setting('app.current_org_id', true), '')::uuid);
