CREATE OR REPLACE VIEW `${PROJECT}.${LEARN}.outcomes_current` (
  id OPTIONS (description = "Outcome event id."),
  org_id OPTIONS (description = "Workspace (tenant). Every query must filter on it."),
  campaign_lead_id OPTIONS (description = "The enrollment (campaign + lead) the outcome belongs to. Null if it could not be attributed."),
  company_key OPTIONS (description = "Company the outcome belongs to (website domain; free-mail keys are hashed)."),
  experiment_id OPTIONS (description = "A/B test the outcome counts for. Null when it cannot be attributed with certainty (never guessed)."),
  variant_id OPTIONS (description = "Subject version the outcome counts for. Null when unattributed."),
  sent_email_id OPTIONS (description = "The email the outcome answers, when known."),
  type OPTIONS (description = "qualified_reply, booked_call, reply, bounce, unsubscribe or complaint."),
  source OPTIONS (description = "Who or what recorded it: inbox_ai, manual, gmail_sync, system, crm or calendar."),
  verification OPTIONS (description = "provisional (an AI label), verified (a person confirmed it) or rejected."),
  occurred_at OPTIONS (description = "When it happened."),
  created_at OPTIONS (description = "When the row was written."),
  verified_at OPTIONS (description = "When a person verified it.")
)
OPTIONS (description = "The CURRENT outcome picture: outcome events nobody has superseded, and per enrollment + type only the latest one (a reply thread may have several replies, but a qualified_reply or booked_call has one current verdict per enrollment). BigQuery port of the Postgres view v_outcomes_current. Source: expelly_raw outcome_events.")
AS
WITH superseded AS (
  SELECT DISTINCT org_id, supersedes_id FROM `${PROJECT}.${RAW}.public_outcome_events` WHERE supersedes_id IS NOT NULL
)
SELECT * EXCEPT (rn)
FROM (
  SELECT
    o.id,
    o.org_id,
    o.campaign_lead_id,
    `${PROJECT}.${LEARN}.safe_company_key`(o.company_key) AS company_key,
    o.experiment_id,
    o.variant_id,
    o.sent_email_id,
    o.type,
    o.source,
    o.verification,
    o.occurred_at,
    o.created_at,
    o.verified_at,
    ROW_NUMBER() OVER (
      PARTITION BY o.org_id, COALESCE(o.campaign_lead_id, o.id), o.type, IF(o.type = 'reply', o.id, '')
      ORDER BY o.occurred_at DESC, o.created_at DESC
    ) AS rn
  FROM `${PROJECT}.${RAW}.public_outcome_events` o
  LEFT JOIN superseded s ON s.org_id = o.org_id AND s.supersedes_id = o.id
  WHERE s.supersedes_id IS NULL
)
WHERE rn = 1;
