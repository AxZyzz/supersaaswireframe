CREATE OR REPLACE VIEW `${PROJECT}.${LEARN}.company_reach` (
  org_id OPTIONS (description = "Workspace (tenant). Every query must filter on it."),
  campaign_id OPTIONS (description = "Campaign the company was first contacted in."),
  offer_id OPTIONS (description = "Offer the campaign promotes."),
  company_key OPTIONS (description = "The unit of counting: one company, however many people at it were contacted (website domain; free-mail keys are hashed)."),
  first_sent_at OPTIONS (description = "When the first first-touch (step 1) email to this company was sent in this campaign. Starts the Response window."),
  country OPTIONS (description = "Audience factor, frozen at enrollment."),
  region OPTIONS (description = "Audience factor, frozen at enrollment."),
  city OPTIONS (description = "Audience factor, frozen at enrollment."),
  industry OPTIONS (description = "Audience factor, frozen at enrollment."),
  size_band OPTIONS (description = "Audience factor, frozen at enrollment."),
  primary_trigger OPTIONS (description = "Audience factor: the main buying trigger (type only)."),
  role_bucket OPTIONS (description = "Audience factor: seniority bucket of the contact."),
  lead_source OPTIONS (description = "Audience factor: where the lead came from."),
  mail_provider OPTIONS (description = "Audience factor: recipient mail provider."),
  timezone OPTIONS (description = "Recipient IANA timezone, if known (send-time analysis uses it, else the workspace timezone)."),
  stars OPTIONS (description = "Audience factor: fit score in stars, null if not scored."),
  variant_label OPTIONS (description = "A/B subject version the company received (A, B, ...), null if no test ran."),
  sender_id OPTIONS (description = "Sender mailbox id of the first touch."),
  subject_text OPTIONS (description = "Subject text of the version sent (template text: merge tags are not filled in, so no recipient data is held)."),
  template_subject OPTIONS (description = "Subject of the step template (used to tell personalised from plain subjects)."),
  delivered OPTIONS (description = "Not bounced. A Reached company is a delivered one; every rate uses reached companies as its base."),
  bounced OPTIONS (description = "The first-touch email bounced."),
  opened OPTIONS (description = "A real (tracked) open of a first-touch email: a diagnostic, never an outcome."),
  replied OPTIONS (description = "The company replied (any reply)."),
  positive OPTIONS (description = "An interested reply: AI-labelled (provisional) or person-verified."),
  qualified_verified OPTIONS (description = "Qualified reply (verified): a person confirmed the reply is a real, interested lead. The primary outcome."),
  booked OPTIONS (description = "Booked call (verified). The secondary outcome."),
  unsubscribed OPTIONS (description = "The company asked to stop."),
  first_reply_at OPTIONS (description = "When the first reply arrived."),
  reply_step OPTIONS (description = "Sequence step of the email the first reply answered.")
)
OPTIONS (description = "One row per (workspace, campaign, company): the company first first-touch email, the audience factors frozen at enrollment, and what happened since (bounce, open, reply, qualified reply, booked call, unsubscribe) from the CURRENT outcomes. The base of every Insights number; the app reads this view. A company contacted in two campaigns has two rows (the app keeps the earliest). Sources: sends_enriched, outcomes_current, email_events, experiment_variants, templates.")
AS
WITH first_touch AS (
  SELECT *
  FROM `${PROJECT}.${LEARN}.sends_enriched`
  WHERE step_order = 1 AND company_key IS NOT NULL
  QUALIFY ROW_NUMBER() OVER (PARTITION BY org_id, campaign_id, company_key ORDER BY sent_at, sent_email_id) = 1
),
opens AS (
  SELECT DISTINCT s.org_id, s.campaign_id, s.company_key
  FROM `${PROJECT}.${LEARN}.sends_enriched` s
  JOIN `${PROJECT}.${RAW}.public_email_events` e
    ON e.sent_email_id = s.sent_email_id AND e.org_id = s.org_id AND e.type = 'open'
  WHERE s.step_order = 1 AND s.company_key IS NOT NULL
),
outcomes AS (
  SELECT
    o.org_id,
    cl.campaign_id,
    o.company_key,
    LOGICAL_OR(o.type = 'bounce') AS bounced,
    LOGICAL_OR(o.type = 'reply') AS replied,
    LOGICAL_OR(o.type = 'qualified_reply' AND o.verification IN ('provisional', 'verified')) AS positive,
    LOGICAL_OR(o.type = 'qualified_reply' AND o.verification = 'verified') AS qualified_verified,
    LOGICAL_OR(o.type = 'booked_call' AND o.verification = 'verified') AS booked,
    LOGICAL_OR(o.type = 'unsubscribe') AS unsubscribed,
    MIN(IF(o.type = 'reply', o.occurred_at, NULL)) AS first_reply_at,
    ARRAY_AGG(IF(o.type = 'reply', o.sent_email_id, NULL) IGNORE NULLS ORDER BY o.occurred_at LIMIT 1)[SAFE_OFFSET(0)] AS first_reply_email
  FROM `${PROJECT}.${LEARN}.outcomes_current` o
  JOIN `${PROJECT}.${RAW}.public_campaign_leads` cl ON cl.id = o.campaign_lead_id AND cl.org_id = o.org_id
  WHERE o.company_key IS NOT NULL
  GROUP BY o.org_id, cl.campaign_id, o.company_key
)
SELECT
  ft.org_id,
  ft.campaign_id,
  ft.offer_id,
  ft.company_key,
  ft.sent_at AS first_sent_at,
  ft.country,
  ft.region,
  ft.city,
  ft.industry,
  ft.size_band,
  ft.primary_trigger,
  ft.role_bucket,
  ft.lead_source,
  ft.mail_provider,
  ft.timezone,
  ft.stars,
  ev.label AS variant_label,
  ft.sender_id,
  COALESCE(ev.subject, t.subject) AS subject_text,
  t.subject AS template_subject,
  NOT COALESCE(oc.bounced, FALSE) AS delivered,
  COALESCE(oc.bounced, FALSE) AS bounced,
  op.company_key IS NOT NULL AS opened,
  COALESCE(oc.replied, FALSE) AS replied,
  COALESCE(oc.positive, FALSE) AS positive,
  COALESCE(oc.qualified_verified, FALSE) AS qualified_verified,
  COALESCE(oc.booked, FALSE) AS booked,
  COALESCE(oc.unsubscribed, FALSE) AS unsubscribed,
  oc.first_reply_at,
  rs.step_order AS reply_step
FROM first_touch ft
LEFT JOIN outcomes oc ON oc.org_id = ft.org_id AND oc.campaign_id = ft.campaign_id AND oc.company_key = ft.company_key
LEFT JOIN opens op ON op.org_id = ft.org_id AND op.campaign_id = ft.campaign_id AND op.company_key = ft.company_key
LEFT JOIN `${PROJECT}.${LEARN}.sends_enriched` rs ON rs.sent_email_id = oc.first_reply_email AND rs.org_id = ft.org_id
LEFT JOIN `${PROJECT}.${RAW}.public_experiment_variants` ev ON ev.id = ft.variant_id AND ev.org_id = ft.org_id
LEFT JOIN `${PROJECT}.${RAW}.public_templates` t ON t.id = ft.template_id AND t.org_id = ft.org_id;
