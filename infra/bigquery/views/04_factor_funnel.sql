CREATE OR REPLACE VIEW `${PROJECT}.${LEARN}.factor_funnel` (
  org_id OPTIONS (description = "Workspace (tenant). Every query must filter on it."),
  offer_id OPTIONS (description = "Offer the campaign promotes."),
  campaign_id OPTIONS (description = "Campaign. Counts are per campaign: a company contacted in two campaigns is counted in both (the Insights page counts it once)."),
  factor OPTIONS (description = "Which factor this row is about: country, region, city, industry, size_band, trigger, role, lead_source, stars or mail_provider."),
  bucket OPTIONS (description = "The factor value (for example Pune). Missing values are the visible bucket unknown."),
  sent OPTIONS (description = "Companies contacted (first-touch email sent)."),
  reached OPTIONS (description = "Reached company: contacted and not bounced. The base of every rate."),
  bounced OPTIONS (description = "Companies whose first-touch email bounced."),
  opened OPTIONS (description = "Reached companies with a real open (diagnostic)."),
  replied OPTIONS (description = "Reached companies that replied."),
  positive OPTIONS (description = "Reached companies with an interested reply (AI-labelled or verified)."),
  qualified OPTIONS (description = "Reached companies with a Qualified reply (verified): the primary outcome."),
  booked OPTIONS (description = "Reached companies with a Booked call (verified): the secondary outcome."),
  unsubscribed OPTIONS (description = "Reached companies that unsubscribed.")
)
OPTIONS (description = "Factor funnel: for each audience factor (country, region, city, industry, size band, trigger, role, lead source, stars, mail provider) and each value of it, how many companies were contacted, reached, replied, qualified and booked. Exploratory: it shows what looks different, never what caused it. Source: company_reach.")
AS
SELECT
  r.org_id,
  r.offer_id,
  r.campaign_id,
  f.factor,
  f.bucket,
  COUNT(*) AS sent,
  COUNTIF(r.delivered) AS reached,
  COUNTIF(r.bounced) AS bounced,
  COUNTIF(r.delivered AND r.opened) AS opened,
  COUNTIF(r.delivered AND r.replied) AS replied,
  COUNTIF(r.delivered AND r.positive) AS positive,
  COUNTIF(r.delivered AND r.qualified_verified) AS qualified,
  COUNTIF(r.delivered AND r.booked) AS booked,
  COUNTIF(r.delivered AND r.unsubscribed) AS unsubscribed
FROM `${PROJECT}.${LEARN}.company_reach` r,
UNNEST([
  STRUCT('country' AS factor, IFNULL(NULLIF(TRIM(r.country), ''), 'unknown') AS bucket),
  STRUCT('region', IFNULL(NULLIF(TRIM(r.region), ''), 'unknown')),
  STRUCT('city', IFNULL(NULLIF(TRIM(r.city), ''), 'unknown')),
  STRUCT('industry', IFNULL(NULLIF(TRIM(r.industry), ''), 'unknown')),
  STRUCT('size_band', IFNULL(NULLIF(TRIM(r.size_band), ''), 'unknown')),
  STRUCT('trigger', IFNULL(NULLIF(TRIM(r.primary_trigger), ''), 'unknown')),
  STRUCT('role', IFNULL(NULLIF(TRIM(r.role_bucket), ''), 'unknown')),
  STRUCT('lead_source', IFNULL(NULLIF(TRIM(r.lead_source), ''), 'unknown')),
  STRUCT('stars', IFNULL(CAST(r.stars AS STRING), 'not_scored')),
  STRUCT('mail_provider', IFNULL(NULLIF(TRIM(r.mail_provider), ''), 'unknown'))
]) AS f
GROUP BY r.org_id, r.offer_id, r.campaign_id, f.factor, f.bucket;
