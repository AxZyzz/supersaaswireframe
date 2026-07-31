-- Open/click/unsubscribe endpoints are hit by mail clients with no auth and no
-- org context, but RLS-FORCE hides every org from the app role. These two
-- SECURITY DEFINER resolvers perform the one controlled cross-tenant read —
-- turning an opaque tracking_id / unsub_token into its owning org (+ ids) — so
-- the request handler can re-enter withOrgContext and record the event under
-- RLS like any other write. The tokens are unguessable UUIDs, so they act as
-- bearer capabilities scoped to a single sent email / recipient.

CREATE OR REPLACE FUNCTION resolve_tracking(p_tracking uuid)
RETURNS TABLE (
  sent_email_id uuid,
  org_id uuid,
  campaign_id uuid,
  lead_id uuid
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT id, org_id, campaign_id, lead_id
  FROM sent_emails
  WHERE tracking_id = p_tracking
  LIMIT 1;
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION resolve_tracking(uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION resolve_tracking(uuid) TO supersaas_app;--> statement-breakpoint

CREATE OR REPLACE FUNCTION resolve_unsub(p_token uuid)
RETURNS TABLE (
  campaign_lead_id uuid,
  org_id uuid,
  campaign_id uuid,
  lead_id uuid,
  email text
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT cl.id, cl.org_id, cl.campaign_id, cl.lead_id, l.email
  FROM campaign_leads cl
  JOIN leads l ON l.id = cl.lead_id
  WHERE cl.unsub_token = p_token
  LIMIT 1;
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION resolve_unsub(uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION resolve_unsub(uuid) TO supersaas_app;
