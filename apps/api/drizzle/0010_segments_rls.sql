-- RLS for segments + segment_members (same tenant-isolation pattern as 0001).
ALTER TABLE "segments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "segments" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "segments_tenant_isolation" ON "segments"
  FOR ALL
  USING ("org_id" = NULLIF(current_setting('app.current_org_id', true), '')::uuid)
  WITH CHECK ("org_id" = NULLIF(current_setting('app.current_org_id', true), '')::uuid);--> statement-breakpoint

ALTER TABLE "segment_members" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "segment_members" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "segment_members_tenant_isolation" ON "segment_members"
  FOR ALL
  USING ("org_id" = NULLIF(current_setting('app.current_org_id', true), '')::uuid)
  WITH CHECK ("org_id" = NULLIF(current_setting('app.current_org_id', true), '')::uuid);
