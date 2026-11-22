CREATE OR REPLACE VIEW `${PROJECT}.${LEARN}.sends_enriched` (
  sent_email_id OPTIONS (description = "Email id."),
  org_id OPTIONS (description = "Workspace (tenant). Every query must filter on it."),
  campaign_id OPTIONS (description = "Campaign the email belongs to."),
  offer_id OPTIONS (description = "Offer the campaign promotes."),
  campaign_lead_id OPTIONS (description = "The enrollment the email was sent for."),
  step_id OPTIONS (description = "Sequence step."),
  step_order OPTIONS (description = "1 = first touch, 2 = first follow-up, and so on."),
  template_id OPTIONS (description = "Template of the step (its subject is in company_reach.template_subject)."),
  sender_id OPTIONS (description = "Sender mailbox id. The address itself is not copied to BigQuery."),
  variant_id OPTIONS (description = "A/B subject version used, if the step had a running test."),
  sent_at OPTIONS (description = "When the email was sent."),
  company_key OPTIONS (description = "Company the recipient belongs to (website domain; free-mail keys are hashed). From the enrollment snapshot."),
  country OPTIONS (description = "Company country, frozen at enrollment."),
  region OPTIONS (description = "Company state or region, frozen at enrollment."),
  city OPTIONS (description = "Company city, frozen at enrollment."),
  industry OPTIONS (description = "Company industry, frozen at enrollment."),
  size_band OPTIONS (description = "Company size band, frozen at enrollment."),
  primary_trigger OPTIONS (description = "Main buying trigger found on the company's website (type only, never the quote)."),
  role_bucket OPTIONS (description = "Seniority bucket of the contact (founder_owner, c_level, ...). The job title is not copied."),
  lead_source OPTIONS (description = "Where the lead came from."),
  mail_provider OPTIONS (description = "Recipient mail provider."),
  timezone OPTIONS (description = "Recipient IANA timezone, if known."),
  stars OPTIONS (description = "Fit score in stars (1-5) at enrollment, null if not scored.")
)
OPTIONS (description = "One row per email actually sent (status = sent), with the factors frozen in the enrollment snapshot. Only whitelisted snapshot keys are exposed: evidence quotes, urls and the raw snapshot never leave expelly_raw. Sources: sent_emails, campaign_steps, campaigns, campaign_leads.")
AS
SELECT
  se.id AS sent_email_id,
  se.org_id,
  se.campaign_id,
  c.offer_id,
  se.campaign_lead_id,
  se.step_id,
  s.step_order,
  s.template_id,
  se.sender_id,
  se.variant_id,
  se.sent_at,
  `${PROJECT}.${LEARN}.safe_company_key`(JSON_VALUE(cl.snapshot, '$.company_key')) AS company_key,
  JSON_VALUE(cl.snapshot, '$.country') AS country,
  JSON_VALUE(cl.snapshot, '$.region') AS region,
  JSON_VALUE(cl.snapshot, '$.city') AS city,
  JSON_VALUE(cl.snapshot, '$.industry') AS industry,
  JSON_VALUE(cl.snapshot, '$.size_band') AS size_band,
  JSON_VALUE(cl.snapshot, '$.primary_trigger') AS primary_trigger,
  JSON_VALUE(cl.snapshot, '$.role_bucket') AS role_bucket,
  JSON_VALUE(cl.snapshot, '$.source') AS lead_source,
  JSON_VALUE(cl.snapshot, '$.mail_provider') AS mail_provider,
  JSON_VALUE(cl.snapshot, '$.timezone') AS timezone,
  CAST(ROUND(SAFE_CAST(JSON_VALUE(cl.snapshot, '$.stars') AS FLOAT64)) AS INT64) AS stars
FROM `${PROJECT}.${RAW}.public_sent_emails` se
JOIN `${PROJECT}.${RAW}.public_campaign_steps` s ON s.id = se.step_id AND s.org_id = se.org_id
JOIN `${PROJECT}.${RAW}.public_campaigns` c ON c.id = se.campaign_id AND c.org_id = se.org_id
LEFT JOIN `${PROJECT}.${RAW}.public_campaign_leads` cl ON cl.id = se.campaign_lead_id AND cl.org_id = se.org_id
WHERE se.status = 'sent';
