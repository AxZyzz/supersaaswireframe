-- Email notifications + weekly summary (T7.5).
--
-- notifications.emailed_at: NULL = not yet considered for email. Existing rows
-- are marked handled so turning this on doesn't email the whole backlog.
ALTER TABLE "notifications" ADD COLUMN "emailed_at" timestamp with time zone;--> statement-breakpoint
UPDATE "notifications" SET "emailed_at" = "created_at";--> statement-breakpoint
CREATE INDEX "notifications_email_pending_idx" ON "notifications" ("created_at") WHERE "emailed_at" IS NULL;--> statement-breakpoint

-- Per-member email mutes (types, plus 'weekly_summary'), like muted_notifications.
ALTER TABLE "memberships" ADD COLUMN "email_muted_notifications" text[] DEFAULT '{}' NOT NULL;--> statement-breakpoint

-- The email worker runs with no org context; RLS hides every org from the app
-- role. These SECURITY DEFINER functions are its only cross-tenant access,
-- same pattern as due_campaign_sends (0021).

-- Notifications waiting for an email decision, at least p_delay old (so a
-- burst lands in one email), with recipient + workspace details.
CREATE OR REPLACE FUNCTION pending_notification_emails(p_limit int, p_delay interval)
RETURNS TABLE (
  id uuid, org_id uuid, user_id uuid, type text, title text, body text,
  link text, read boolean, created_at timestamptz,
  user_email text, user_name text, org_name text, email_muted boolean
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT n.id, n.org_id, n.user_id, n.type, n.title, n.body, n.link,
         n.read_at IS NOT NULL, n.created_at,
         u.email, u.name, o.name,
         COALESCE(n.type = ANY (m.email_muted_notifications), true)
  FROM notifications n
  JOIN users u ON u.id = n.user_id
  JOIN orgs o ON o.id = n.org_id
  LEFT JOIN memberships m ON m.org_id = n.org_id AND m.user_id = n.user_id
  WHERE n.emailed_at IS NULL AND n.created_at <= now() - p_delay
  ORDER BY n.created_at
  LIMIT p_limit;
$$;--> statement-breakpoint

CREATE OR REPLACE FUNCTION mark_notifications_emailed(p_ids uuid[])
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE notifications SET emailed_at = now()
  WHERE id = ANY (p_ids) AND emailed_at IS NULL;
$$;--> statement-breakpoint

-- Admins/managers who get the Monday summary (not muted), per workspace.
CREATE OR REPLACE FUNCTION weekly_summary_recipients()
RETURNS TABLE (org_id uuid, org_name text, user_id uuid, user_email text, user_name text)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT m.org_id, o.name, u.id, u.email, u.name
  FROM memberships m
  JOIN orgs o ON o.id = m.org_id
  JOIN users u ON u.id = m.user_id
  WHERE m.role IN ('admin', 'manager')
    AND NOT ('weekly_summary' = ANY (m.email_muted_notifications))
  ORDER BY m.org_id;
$$;--> statement-breakpoint

REVOKE ALL ON FUNCTION pending_notification_emails(int, interval) FROM PUBLIC;--> statement-breakpoint
REVOKE ALL ON FUNCTION mark_notifications_emailed(uuid[]) FROM PUBLIC;--> statement-breakpoint
REVOKE ALL ON FUNCTION weekly_summary_recipients() FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION pending_notification_emails(int, interval) TO supersaas_app;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION mark_notifications_emailed(uuid[]) TO supersaas_app;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION weekly_summary_recipients() TO supersaas_app;
