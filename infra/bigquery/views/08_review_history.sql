CREATE OR REPLACE VIEW `${PROJECT}.${LEARN}.review_history` (
  org_id OPTIONS (description = "Workspace (tenant). Every query must filter on it."),
  experiment_id OPTIONS (description = "The A/B test the review is about."),
  campaign_id OPTIONS (description = "Campaign the test ran in."),
  offer_id OPTIONS (description = "Offer the test belongs to."),
  revision OPTIONS (description = "Review revision number: a new revision is written only when the numbers moved."),
  policy_version OPTIONS (description = "Version of the decision policy that produced it."),
  computed_at OPTIONS (description = "When this revision was computed."),
  decision OPTIONS (description = "What the policy said: promote, inconclusive, and so on. Computed by code, never by AI."),
  lift OPTIONS (description = "Estimated lift of the challenger over the control in the primary outcome, as a fraction (0.02 = 2 percentage points)."),
  lift_lo OPTIONS (description = "Lower end of the 95 percent confidence interval of that lift."),
  lift_hi OPTIONS (description = "Upper end of the 95 percent confidence interval of that lift."),
  explanation_source OPTIONS (description = "How the plain-words explanation was written: template, gemini or agent. The explanation text itself is not copied.")
)
OPTIONS (description = "Review history: every real (non-simulated) Review revision over time, with the decision and the lift with its confidence interval. Simulated Try-simulation reviews are excluded and never mixed in. Sources: reviews, experiments.")
AS
SELECT
  r.org_id,
  r.experiment_id,
  e.campaign_id,
  e.offer_ref AS offer_id,
  r.revision,
  r.policy_version,
  r.computed_at,
  JSON_VALUE(r.result, '$.decision') AS decision,
  SAFE_CAST(JSON_VALUE(r.result, '$.lift.d') AS FLOAT64) AS lift,
  SAFE_CAST(JSON_VALUE(r.result, '$.lift.lo') AS FLOAT64) AS lift_lo,
  SAFE_CAST(JSON_VALUE(r.result, '$.lift.hi') AS FLOAT64) AS lift_hi,
  r.explanation_source
FROM `${PROJECT}.${RAW}.public_reviews` r
LEFT JOIN `${PROJECT}.${RAW}.public_experiments` e ON e.id = r.experiment_id AND e.org_id = r.org_id
WHERE NOT r.simulated;
