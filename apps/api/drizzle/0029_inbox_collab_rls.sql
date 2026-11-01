-- RLS for conversation_notes + notifications (pattern as in 0001).
ALTER TABLE "conversation_notes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "conversation_notes" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "conversation_notes_tenant_isolation" ON "conversation_notes"
  FOR ALL
  USING ("org_id" = NULLIF(current_setting('app.current_org_id', true), '')::uuid)
  WITH CHECK ("org_id" = NULLIF(current_setting('app.current_org_id', true), '')::uuid);--> statement-breakpoint
ALTER TABLE "notifications" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "notifications" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "notifications_tenant_isolation" ON "notifications"
  FOR ALL
  USING ("org_id" = NULLIF(current_setting('app.current_org_id', true), '')::uuid)
  WITH CHECK ("org_id" = NULLIF(current_setting('app.current_org_id', true), '')::uuid);
