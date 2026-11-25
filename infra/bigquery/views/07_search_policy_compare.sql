CREATE OR REPLACE VIEW `${PROJECT}.${LEARN}.search_policy_compare` (
  org_id OPTIONS (description = "Workspace (tenant). Every query must filter on it."),
  offer_id OPTIONS (description = "Offer the Discover runs were for."),
  preference_id OPTIONS (description = "The Search preference that was active for these runs."),
  preference_factor OPTIONS (description = "What the preference asked for more of (city, industry, trigger, ...)."),
  preference_label OPTIONS (description = "Readable name of the preference."),
  arm OPTIONS (description = "targeted = prospects found through the reserved share (at most 20 percent of a batch); baseline = the same runs normal search."),
  runs OPTIONS (description = "Discover runs that ran under this preference (the search budget unit)."),
  discovered OPTIONS (description = "Verified prospects in this arm."),
  became_lead OPTIONS (description = "...imported as leads."),
  became_lead_share OPTIONS (description = "became_lead / discovered: how often a prospect had a usable contact. Stands in for the Eligible share, because BigQuery holds no email addresses."),
  reached OPTIONS (description = "...contacted and not bounced (Reached company)."),
  replied OPTIONS (description = "...that replied."),
  qualified OPTIONS (description = "...with a Qualified reply (verified): the primary outcome."),
  qualified_per_reached OPTIONS (description = "qualified / reached: null until something was reached."),
  qualified_per_run OPTIONS (description = "qualified / runs: qualified replies per search budget (per Discover run).")
)
OPTIONS (description = "Search-policy comparison: for each Search preference, the prospects it found (targeted) against the normal search in the same runs (baseline): how many were discovered, turned into leads, reached and qualified, per reached company and per Discover run. Exploratory: arms are not randomised, so a gap is a reason to keep testing, not proof. Sources: prospects, prospect_runs, search_preferences, company_reach.")
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
selected AS (
  SELECT
    p.org_id,
    r.offer_id,
    r.preference_id,
    r.id AS run_id,
    p.via_preference,
    p.lead_id,
    `${PROJECT}.${LEARN}.safe_company_key`(p.company_key) AS company_key
  FROM `${PROJECT}.${RAW}.public_prospects` p
  JOIN `${PROJECT}.${RAW}.public_prospect_runs` r ON r.id = p.run_id AND r.org_id = p.org_id
  WHERE p.status = 'verified' AND r.preference_id IS NOT NULL
)
SELECT
  s.org_id,
  s.offer_id,
  s.preference_id,
  sp.factor AS preference_factor,
  sp.label AS preference_label,
  IF(s.via_preference, 'targeted', 'baseline') AS arm,
  COUNT(DISTINCT s.run_id) AS runs,
  COUNT(*) AS discovered,
  COUNTIF(s.lead_id IS NOT NULL) AS became_lead,
  SAFE_DIVIDE(COUNTIF(s.lead_id IS NOT NULL), COUNT(*)) AS became_lead_share,
  COUNTIF(IFNULL(re.reached, FALSE)) AS reached,
  COUNTIF(IFNULL(re.replied, FALSE)) AS replied,
  COUNTIF(IFNULL(re.qualified, FALSE)) AS qualified,
  SAFE_DIVIDE(COUNTIF(IFNULL(re.qualified, FALSE)), COUNTIF(IFNULL(re.reached, FALSE))) AS qualified_per_reached,
  SAFE_DIVIDE(COUNTIF(IFNULL(re.qualified, FALSE)), COUNT(DISTINCT s.run_id)) AS qualified_per_run
FROM selected s
LEFT JOIN reach re ON re.org_id = s.org_id AND re.company_key = s.company_key
LEFT JOIN `${PROJECT}.${RAW}.public_search_preferences` sp ON sp.id = s.preference_id AND sp.org_id = s.org_id
GROUP BY s.org_id, s.offer_id, s.preference_id, preference_factor, preference_label, arm;
