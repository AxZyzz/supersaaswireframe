-- Learning Loop T16: the demo workspace's send-time grid, for the Looker Studio heatmap.
-- ${DEMO_ORG_ID} is the one workspace allowed to appear. apply-demo.sh fills it in; it is not stored in git.
-- day_sorted and block_sorted sort in the right order as plain text, so a pivot table lists Mon to Sun and 6-8 am to 8-10 pm.
CREATE OR REPLACE VIEW `${PROJECT}.${DEMO}.demo_send_time_grid`
OPTIONS (description = "Demo workspace only: when first-touch emails went out (day of week x 2-hour block) and how those companies responded. Observation only: a hot cell is a hint, not a finding. day_sorted and block_sorted are text labels that sort in the right order for a heatmap. Source: expelly_learning.send_time_grid.")
AS
SELECT
  * EXCEPT (org_id),
  CONCAT(CAST(day + 1 AS STRING), ') ', day_label) AS day_sorted,
  CONCAT(CAST(block AS STRING), ') ', block_label) AS block_sorted
FROM `${PROJECT}.${LEARN}.send_time_grid`
WHERE org_id = '${DEMO_ORG_ID}';
