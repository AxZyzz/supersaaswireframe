CREATE OR REPLACE VIEW `${PROJECT}.${LEARN}.send_time_grid` (
  org_id OPTIONS (description = "Workspace (tenant). Every query must filter on it."),
  offer_id OPTIONS (description = "Offer the campaign promotes."),
  campaign_id OPTIONS (description = "Campaign."),
  tz_basis OPTIONS (description = "recipient = the send time is in the company own timezone; workspace = the company timezone was unknown, so the workspace timezone was used. Say which when you show it."),
  day OPTIONS (description = "Day of week of the first-touch send: 0 = Monday ... 6 = Sunday."),
  day_label OPTIONS (description = "Mon ... Sun."),
  block OPTIONS (description = "2-hour block of the send: 0 = 6-8 am ... 7 = 8-10 pm. Sends outside 6 am-10 pm are left out."),
  block_label OPTIONS (description = "Readable name of the block."),
  reached OPTIONS (description = "Reached companies first contacted in this cell."),
  replied OPTIONS (description = "...of which replied."),
  qualified OPTIONS (description = "...of which have a Qualified reply (verified).")
)
OPTIONS (description = "Send-time grid: when first-touch emails went out (day of week x 2-hour block, in the recipient timezone when known) and how those companies responded. Observation only: send times are never varied on purpose except by an explicit send-time test, so a hot cell is a hint, not a finding. Sources: company_reach, orgs.")
AS
WITH local_time AS (
  SELECT
    r.org_id, r.offer_id, r.campaign_id, r.delivered, r.replied, r.qualified_verified,
    SAFE.DATETIME(r.first_sent_at, NULLIF(r.timezone, 'unknown')) AS recipient_dt,
    COALESCE(SAFE.DATETIME(r.first_sent_at, o.timezone), DATETIME(r.first_sent_at, 'UTC')) AS workspace_dt
  FROM `${PROJECT}.${LEARN}.company_reach` r
  LEFT JOIN `${PROJECT}.${RAW}.public_orgs` o ON o.id = r.org_id
),
slotted AS (
  SELECT
    *,
    COALESCE(recipient_dt, workspace_dt) AS local_dt,
    IF(recipient_dt IS NOT NULL, 'recipient', 'workspace') AS basis
  FROM local_time
  WHERE delivered
),
cells AS (
  SELECT
    *,
    MOD(EXTRACT(DAYOFWEEK FROM local_dt) + 5, 7) AS d,
    IF(EXTRACT(HOUR FROM local_dt) BETWEEN 6 AND 21, DIV(EXTRACT(HOUR FROM local_dt) - 6, 2), NULL) AS b
  FROM slotted
)
SELECT
  org_id,
  offer_id,
  campaign_id,
  basis AS tz_basis,
  d AS day,
  ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'][OFFSET(d)] AS day_label,
  b AS block,
  ['6-8 am', '8-10 am', '10 am-12', '12-2 pm', '2-4 pm', '4-6 pm', '6-8 pm', '8-10 pm'][OFFSET(b)] AS block_label,
  COUNT(*) AS reached,
  COUNTIF(replied) AS replied,
  COUNTIF(qualified_verified) AS qualified
FROM cells
WHERE b IS NOT NULL
GROUP BY org_id, offer_id, campaign_id, basis, d, b;
