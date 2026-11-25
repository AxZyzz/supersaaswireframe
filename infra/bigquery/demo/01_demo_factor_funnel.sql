-- Learning Loop T16: the demo workspace's factor funnel, for the Looker Studio dashboard.
-- ${DEMO_ORG_ID} is the one workspace allowed to appear. apply-demo.sh fills it in; it is not stored in git.
CREATE OR REPLACE VIEW `${PROJECT}.${DEMO}.demo_factor_funnel`
OPTIONS (description = "Demo workspace only: the factor funnel (for each audience factor and each value of it, companies contacted, reached, replied, qualified and booked). One company counts in EVERY factor, so never add up rows of different factors: filter on a single factor first. Source: expelly_learning.factor_funnel.")
AS
SELECT * EXCEPT (org_id)
FROM `${PROJECT}.${LEARN}.factor_funnel`
WHERE org_id = '${DEMO_ORG_ID}';
