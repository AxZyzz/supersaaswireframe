CREATE OR REPLACE VIEW `${PROJECT}.${LEARN}.discovery_funnel` (
  org_id OPTIONS (description = "Workspace (tenant). Every query must filter on it."),
  offer_id OPTIONS (description = "Offer the Discover run was for."),
  factor OPTIONS (description = "country, region, city, industry, size_band or trigger: the factors Discover can search for."),
  bucket OPTIONS (description = "The factor value. Missing values are the visible bucket unknown."),
  via_preference OPTIONS (description = "TRUE = found through an active Search preference (the reserved share); FALSE = found by the normal search."),
  discovered OPTIONS (description = "Verified Discover prospects (companies checked on their own website)."),
  became_lead OPTIONS (description = "...of which were imported as leads (a usable contact exists). BigQuery holds no email addresses, so this stands in for the Postgres-side Eligible count."),
  reached OPTIONS (description = "...of which were then contacted and not bounced (Reached company)."),
  replied OPTIONS (description = "...of which replied."),
  qualified OPTIONS (description = "...of which have a Qualified reply (verified).")
)
OPTIONS (description = "Discovery funnel: Discover prospects to leads to reached companies to qualified replies, by factor value and by whether a Search preference found them. Feeds the search-policy comparison. Sources: prospects, prospect_runs, company_reach.")
AS
WITH reach AS (
  SELECT
    org_id,
    company_key,
    LOGICAL_OR(delivered) AS reached,
    LOGICAL_OR(delivered AND replied) AS replied,
    LOGICAL_OR(delivered AND qualified_verified) AS qualified
  FROM `${PROJECT}.${LEARN}.company_reach`
  GROUP BY org_id, company_key
),
prospect AS (
  SELECT
    p.org_id,
    r.offer_id,
    p.via_preference,
    p.lead_id,
    `${PROJECT}.${LEARN}.safe_company_key`(p.company_key) AS company_key,
    p.country,
    p.region,
    p.city,
    p.industry,
    p.size_band,
    JSON_VALUE(p.triggers, '$[0].type') AS trigger
  FROM `${PROJECT}.${RAW}.public_prospects` p
  JOIN `${PROJECT}.${RAW}.public_prospect_runs` r ON r.id = p.run_id AND r.org_id = p.org_id
  WHERE p.status = 'verified'
)
SELECT
  p.org_id,
  p.offer_id,
  f.factor,
  f.bucket,
  p.via_preference,
  COUNT(*) AS discovered,
  COUNTIF(p.lead_id IS NOT NULL) AS became_lead,
  COUNTIF(IFNULL(re.reached, FALSE)) AS reached,
  COUNTIF(IFNULL(re.replied, FALSE)) AS replied,
  COUNTIF(IFNULL(re.qualified, FALSE)) AS qualified
FROM prospect p
LEFT JOIN reach re ON re.org_id = p.org_id AND re.company_key = p.company_key,
UNNEST([
  STRUCT('country' AS factor, IFNULL(NULLIF(TRIM(p.country), ''), 'unknown') AS bucket),
  STRUCT('region', IFNULL(NULLIF(TRIM(p.region), ''), 'unknown')),
  STRUCT('city', IFNULL(NULLIF(TRIM(p.city), ''), 'unknown')),
  STRUCT('industry', IFNULL(NULLIF(TRIM(p.industry), ''), 'unknown')),
  STRUCT('size_band', IFNULL(NULLIF(TRIM(p.size_band), ''), 'unknown')),
  STRUCT('trigger', IFNULL(NULLIF(TRIM(p.trigger), ''), 'unknown'))
]) AS f
GROUP BY p.org_id, p.offer_id, f.factor, f.bucket, p.via_preference;
