-- The send worker runs with no org context, but RLS-FORCE hides other orgs from
-- the app role. This SECURITY DEFINER function performs the one controlled
-- cross-tenant read: which campaign_leads are due to send right now. The worker
-- then re-enters each row under its own org context (withOrgContext) to render,
-- send, and record — so every write still passes RLS. Optional p_org narrows
-- the scan to a single org (used by the manual "run due sends" trigger).

CREATE OR REPLACE FUNCTION due_campaign_sends(p_max int, p_org uuid DEFAULT NULL)
RETURNS TABLE (
  campaign_lead_id uuid,
  org_id uuid,
  campaign_id uuid,
  lead_id uuid,
  current_step int
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT cl.id, cl.org_id, cl.campaign_id, cl.lead_id, cl.current_step
  FROM campaign_leads cl
  JOIN campaigns c ON c.id = cl.campaign_id
  WHERE cl.status = 'active'
    AND c.status = 'active'
    AND cl.next_send_at IS NOT NULL
    AND cl.next_send_at <= now()
    AND (p_org IS NULL OR cl.org_id = p_org)
  ORDER BY cl.next_send_at
  LIMIT p_max;
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION due_campaign_sends(int, uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION due_campaign_sends(int, uuid) TO supersaas_app;
