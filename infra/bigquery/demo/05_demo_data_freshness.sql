-- Learning Loop T16: how fresh the demo workspace's data is (the "Data as of" tile).
-- ${DEMO_ORG_ID} is the one workspace allowed to appear. apply-demo.sh fills it in; it is not stored in git.
CREATE OR REPLACE VIEW `${PROJECT}.${DEMO}.demo_data_freshness`
OPTIONS (description = "Demo workspace only: Data as of, the newest database change from the demo workspace that has reached BigQuery. Source: expelly_learning.data_freshness.")
AS
SELECT * EXCEPT (org_id)
FROM `${PROJECT}.${LEARN}.data_freshness`
WHERE org_id = '${DEMO_ORG_ID}';
