-- Learning Loop T16: the demo workspace's review history, for the Looker Studio dashboard.
-- ${DEMO_ORG_ID} is the one workspace allowed to appear. apply-demo.sh fills it in; it is not stored in git.
CREATE OR REPLACE VIEW `${PROJECT}.${DEMO}.demo_review_history`
OPTIONS (description = "Demo workspace only: every real Review revision over time, with the decision and the lift with its confidence interval. Source: expelly_learning.review_history.")
AS
SELECT * EXCEPT (org_id)
FROM `${PROJECT}.${LEARN}.review_history`
WHERE org_id = '${DEMO_ORG_ID}';
