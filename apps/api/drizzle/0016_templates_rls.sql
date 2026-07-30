-- RLS for template_folders + templates (same tenant-isolation pattern as 0001).
ALTER TABLE "template_folders" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "template_folders" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "template_folders_tenant_isolation" ON "template_folders"
  FOR ALL
  USING ("org_id" = NULLIF(current_setting('app.current_org_id', true), '')::uuid)
  WITH CHECK ("org_id" = NULLIF(current_setting('app.current_org_id', true), '')::uuid);--> statement-breakpoint
ALTER TABLE "templates" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "templates" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "templates_tenant_isolation" ON "templates"
  FOR ALL
  USING ("org_id" = NULLIF(current_setting('app.current_org_id', true), '')::uuid)
  WITH CHECK ("org_id" = NULLIF(current_setting('app.current_org_id', true), '')::uuid);
