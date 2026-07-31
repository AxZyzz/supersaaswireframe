-- RLS for sent_emails + email_events + suppression_list (pattern as in 0001).
ALTER TABLE "sent_emails" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "sent_emails" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "sent_emails_tenant_isolation" ON "sent_emails"
  FOR ALL
  USING ("org_id" = NULLIF(current_setting('app.current_org_id', true), '')::uuid)
  WITH CHECK ("org_id" = NULLIF(current_setting('app.current_org_id', true), '')::uuid);--> statement-breakpoint
ALTER TABLE "email_events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "email_events" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "email_events_tenant_isolation" ON "email_events"
  FOR ALL
  USING ("org_id" = NULLIF(current_setting('app.current_org_id', true), '')::uuid)
  WITH CHECK ("org_id" = NULLIF(current_setting('app.current_org_id', true), '')::uuid);--> statement-breakpoint
ALTER TABLE "suppression_list" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "suppression_list" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "suppression_list_tenant_isolation" ON "suppression_list"
  FOR ALL
  USING ("org_id" = NULLIF(current_setting('app.current_org_id', true), '')::uuid)
  WITH CHECK ("org_id" = NULLIF(current_setting('app.current_org_id', true), '')::uuid);
