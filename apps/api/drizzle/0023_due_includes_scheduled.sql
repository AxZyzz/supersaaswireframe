-- Scheduling (E4 chunk 3) enrolls leads with next_send_at pinned to a future
-- start and marks the campaign 'scheduled'. Widen the due-scan to surface those
-- leads once their time arrives; the worker promotes the campaign to 'active' on
-- the first send (see send.service processLead). Otherwise identical to 0021.

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
    AND c.status IN ('active', 'scheduled')
    AND cl.next_send_at IS NOT NULL
    AND cl.next_send_at <= now()
    AND (p_org IS NULL OR cl.org_id = p_org)
  ORDER BY cl.next_send_at
  LIMIT p_max;
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION due_campaign_sends(int, uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION due_campaign_sends(int, uuid) TO supersaas_app;
