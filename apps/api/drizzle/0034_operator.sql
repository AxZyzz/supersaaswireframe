-- T8.6 operator console: A2B staff (not workspace admins) can see platform-wide
-- health. Operators are flagged on the global users table — granted only from
-- the CLI (npm run operator:grant), never through the API.
ALTER TABLE "users" ADD COLUMN "is_operator" boolean DEFAULT false NOT NULL;--> statement-breakpoint

-- The app role can't read across tenants (RLS). These SECURITY DEFINER
-- functions are the operator console's only cross-tenant window. They return
-- aggregates and metadata — lead email addresses are masked — and the API only
-- calls them after verifying users.is_operator.

CREATE OR REPLACE FUNCTION operator_overview()
RETURNS TABLE (
  orgs int, orgs_7d int, users int, active_campaigns int,
  sent_24h int, sent_7d int, failed_24h int, replies_7d int, leads int
)
LANGUAGE sql SECURITY DEFINER SET search_path = public STABLE
AS $$
  SELECT
    (SELECT count(*)::int FROM orgs),
    (SELECT count(*)::int FROM orgs WHERE created_at > now() - interval '7 days'),
    (SELECT count(*)::int FROM users),
    (SELECT count(*)::int FROM campaigns WHERE status IN ('active', 'scheduled')),
    (SELECT count(*)::int FROM sent_emails WHERE status = 'sent' AND sent_at > now() - interval '1 day'),
    (SELECT count(*)::int FROM sent_emails WHERE status = 'sent' AND sent_at > now() - interval '7 days'),
    (SELECT count(*)::int FROM sent_emails WHERE status = 'failed' AND sent_at > now() - interval '1 day'),
    (SELECT count(*)::int FROM email_events WHERE type = 'reply' AND created_at > now() - interval '7 days'),
    (SELECT count(*)::int FROM leads);
$$;--> statement-breakpoint

CREATE OR REPLACE FUNCTION operator_orgs()
RETURNS TABLE (
  id uuid, name text, slug text, plan text, created_at timestamptz,
  onboarded_at timestamptz, members int, leads int, active_campaigns int,
  sent_7d int, failed_7d int, last_sent_at timestamptz
)
LANGUAGE sql SECURITY DEFINER SET search_path = public STABLE
AS $$
  SELECT o.id, o.name, o.slug, o.plan, o.created_at, o.onboarded_at,
    (SELECT count(*)::int FROM memberships m WHERE m.org_id = o.id),
    (SELECT count(*)::int FROM leads l WHERE l.org_id = o.id),
    (SELECT count(*)::int FROM campaigns c WHERE c.org_id = o.id AND c.status IN ('active', 'scheduled')),
    (SELECT count(*)::int FROM sent_emails s WHERE s.org_id = o.id AND s.status = 'sent' AND s.sent_at > now() - interval '7 days'),
    (SELECT count(*)::int FROM sent_emails s WHERE s.org_id = o.id AND s.status = 'failed' AND s.sent_at > now() - interval '7 days'),
    (SELECT max(s.sent_at) FROM sent_emails s WHERE s.org_id = o.id)
  FROM orgs o
  ORDER BY o.created_at DESC;
$$;--> statement-breakpoint

CREATE OR REPLACE FUNCTION operator_org_members(p_org uuid)
RETURNS TABLE (name text, email text, role "role", joined_at timestamptz)
LANGUAGE sql SECURITY DEFINER SET search_path = public STABLE
AS $$
  SELECT u.name, u.email, m.role, m.created_at
  FROM memberships m JOIN users u ON u.id = m.user_id
  WHERE m.org_id = p_org
  ORDER BY m.created_at;
$$;--> statement-breakpoint

-- Recent failures across the platform: failed sends + failed imports.
-- Recipient addresses are masked (first letter + domain).
CREATE OR REPLACE FUNCTION operator_failures(p_limit int)
RETURNS TABLE (kind text, org_id uuid, org_name text, detail text, error text, at timestamptz)
LANGUAGE sql SECURITY DEFINER SET search_path = public STABLE
AS $$
  (SELECT 'send'::text, s.org_id, o.name,
          left(s.to_email, 1) || '***@' || split_part(s.to_email, '@', 2),
          s.error, s.sent_at
   FROM sent_emails s JOIN orgs o ON o.id = s.org_id
   WHERE s.status = 'failed'
   ORDER BY s.sent_at DESC
   LIMIT p_limit)
  UNION ALL
  (SELECT 'import'::text, j.org_id, o.name, 'CSV import', left(j.errors::text, 300), j.created_at
   FROM import_jobs j JOIN orgs o ON o.id = j.org_id
   WHERE j.status = 'failed'
   ORDER BY j.created_at DESC
   LIMIT p_limit)
  ORDER BY 6 DESC
  LIMIT p_limit;
$$;--> statement-breakpoint

-- Sends per day, last 14 days, platform-wide.
CREATE OR REPLACE FUNCTION operator_daily_sends()
RETURNS TABLE (day date, sent int, failed int)
LANGUAGE sql SECURITY DEFINER SET search_path = public STABLE
AS $$
  SELECT d::date,
    (SELECT count(*)::int FROM sent_emails s WHERE s.status = 'sent' AND s.sent_at::date = d::date),
    (SELECT count(*)::int FROM sent_emails s WHERE s.status = 'failed' AND s.sent_at::date = d::date)
  FROM generate_series(current_date - 13, current_date, interval '1 day') d
  ORDER BY 1;
$$;--> statement-breakpoint

CREATE OR REPLACE FUNCTION operator_set_plan(p_org uuid, p_plan text)
RETURNS boolean
LANGUAGE sql SECURITY DEFINER SET search_path = public
AS $$
  UPDATE orgs SET plan = p_plan, updated_at = now() WHERE id = p_org RETURNING true;
$$;--> statement-breakpoint

REVOKE ALL ON FUNCTION operator_overview() FROM PUBLIC;--> statement-breakpoint
REVOKE ALL ON FUNCTION operator_orgs() FROM PUBLIC;--> statement-breakpoint
REVOKE ALL ON FUNCTION operator_org_members(uuid) FROM PUBLIC;--> statement-breakpoint
REVOKE ALL ON FUNCTION operator_failures(int) FROM PUBLIC;--> statement-breakpoint
REVOKE ALL ON FUNCTION operator_daily_sends() FROM PUBLIC;--> statement-breakpoint
REVOKE ALL ON FUNCTION operator_set_plan(uuid, text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION operator_overview() TO supersaas_app;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION operator_orgs() TO supersaas_app;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION operator_org_members(uuid) TO supersaas_app;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION operator_failures(int) TO supersaas_app;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION operator_daily_sends() TO supersaas_app;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION operator_set_plan(uuid, text) TO supersaas_app;
