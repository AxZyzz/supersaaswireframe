-- RLS for sender_accounts (same tenant-isolation pattern as 0001).
ALTER TABLE "sender_accounts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "sender_accounts" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "sender_accounts_tenant_isolation" ON "sender_accounts"
  FOR ALL
  USING ("org_id" = NULLIF(current_setting('app.current_org_id', true), '')::uuid)
  WITH CHECK ("org_id" = NULLIF(current_setting('app.current_org_id', true), '')::uuid);
