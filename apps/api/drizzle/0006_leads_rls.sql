-- RLS for the E2 lead tables. Same pattern as 0001: ENABLE + FORCE, policies
-- keyed on app.current_org_id, NULLIF-guarded so no context = no rows.
-- Every table carries org_id directly (lead_tags too) so each policy is a
-- simple self-check — no joins, no recursion.

ALTER TABLE "leads" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "leads" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "leads_tenant_isolation" ON "leads"
  FOR ALL
  USING ("org_id" = NULLIF(current_setting('app.current_org_id', true), '')::uuid)
  WITH CHECK ("org_id" = NULLIF(current_setting('app.current_org_id', true), '')::uuid);--> statement-breakpoint

ALTER TABLE "tags" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "tags" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tags_tenant_isolation" ON "tags"
  FOR ALL
  USING ("org_id" = NULLIF(current_setting('app.current_org_id', true), '')::uuid)
  WITH CHECK ("org_id" = NULLIF(current_setting('app.current_org_id', true), '')::uuid);--> statement-breakpoint

ALTER TABLE "lead_tags" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "lead_tags" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "lead_tags_tenant_isolation" ON "lead_tags"
  FOR ALL
  USING ("org_id" = NULLIF(current_setting('app.current_org_id', true), '')::uuid)
  WITH CHECK ("org_id" = NULLIF(current_setting('app.current_org_id', true), '')::uuid);--> statement-breakpoint

ALTER TABLE "lead_notes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "lead_notes" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "lead_notes_tenant_isolation" ON "lead_notes"
  FOR ALL
  USING ("org_id" = NULLIF(current_setting('app.current_org_id', true), '')::uuid)
  WITH CHECK ("org_id" = NULLIF(current_setting('app.current_org_id', true), '')::uuid);--> statement-breakpoint

ALTER TABLE "lead_events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "lead_events" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "lead_events_tenant_isolation" ON "lead_events"
  FOR ALL
  USING ("org_id" = NULLIF(current_setting('app.current_org_id', true), '')::uuid)
  WITH CHECK ("org_id" = NULLIF(current_setting('app.current_org_id', true), '')::uuid);
