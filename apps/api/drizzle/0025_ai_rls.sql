-- RLS for ai_usage + org_knowledge (pattern as in 0001).
ALTER TABLE "ai_usage" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "ai_usage" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "ai_usage_tenant_isolation" ON "ai_usage"
  FOR ALL
  USING ("org_id" = NULLIF(current_setting('app.current_org_id', true), '')::uuid)
  WITH CHECK ("org_id" = NULLIF(current_setting('app.current_org_id', true), '')::uuid);--> statement-breakpoint
ALTER TABLE "org_knowledge" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "org_knowledge" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "org_knowledge_tenant_isolation" ON "org_knowledge"
  FOR ALL
  USING ("org_id" = NULLIF(current_setting('app.current_org_id', true), '')::uuid)
  WITH CHECK ("org_id" = NULLIF(current_setting('app.current_org_id', true), '')::uuid);
