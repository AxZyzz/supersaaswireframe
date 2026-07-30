-- RLS for campaigns + campaign_steps + campaign_leads (pattern as in 0001).
ALTER TABLE "campaigns" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "campaigns" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "campaigns_tenant_isolation" ON "campaigns"
  FOR ALL
  USING ("org_id" = NULLIF(current_setting('app.current_org_id', true), '')::uuid)
  WITH CHECK ("org_id" = NULLIF(current_setting('app.current_org_id', true), '')::uuid);--> statement-breakpoint
ALTER TABLE "campaign_steps" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "campaign_steps" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "campaign_steps_tenant_isolation" ON "campaign_steps"
  FOR ALL
  USING ("org_id" = NULLIF(current_setting('app.current_org_id', true), '')::uuid)
  WITH CHECK ("org_id" = NULLIF(current_setting('app.current_org_id', true), '')::uuid);--> statement-breakpoint
ALTER TABLE "campaign_leads" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "campaign_leads" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "campaign_leads_tenant_isolation" ON "campaign_leads"
  FOR ALL
  USING ("org_id" = NULLIF(current_setting('app.current_org_id', true), '')::uuid)
  WITH CHECK ("org_id" = NULLIF(current_setting('app.current_org_id', true), '')::uuid);
