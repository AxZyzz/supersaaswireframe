-- Learning Loop T16: booked calls verified from Google Calendar. A workspace can
-- connect a Google Calendar (read-only, optional); every 15 minutes the API
-- reads new or changed events and turns a meeting with one of our leads into a
-- verified booked_call outcome. Additive only: the existing `integrations`
-- table gets a second allowed provider, plus the one cross-tenant read the
-- sync job needs (which workspaces have a calendar connected).

ALTER TABLE "integrations" DROP CONSTRAINT "integrations_provider_check";--> statement-breakpoint
ALTER TABLE "integrations" ADD CONSTRAINT "integrations_provider_check"
  CHECK ("provider" IN ('google_sheets', 'google_calendar'));--> statement-breakpoint

-- The sync job's one cross-tenant read: workspaces with a connected calendar
-- that has not been read in the last p_every. Same pattern as due_sheet_syncs.
CREATE OR REPLACE FUNCTION due_calendar_syncs(p_every interval)
RETURNS TABLE (org_id uuid)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT i.org_id FROM integrations i
  WHERE i.provider = 'google_calendar'
    AND COALESCE(i.config->>'needsReconnect', 'false') <> 'true'
    AND (i.config->>'lastSyncedAt' IS NULL
         OR (i.config->>'lastSyncedAt')::timestamptz <= now() - p_every)
  ORDER BY (i.config->>'lastSyncedAt')::timestamptz NULLS FIRST
  LIMIT 200;
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION due_calendar_syncs(interval) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION due_calendar_syncs(interval) TO supersaas_app;
