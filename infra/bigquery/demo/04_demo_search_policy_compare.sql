-- Learning Loop T16: the demo workspace's targeted-vs-baseline search results, for the Looker Studio dashboard.
-- ${DEMO_ORG_ID} is the one workspace allowed to appear. apply-demo.sh fills it in; it is not stored in git.
CREATE OR REPLACE VIEW `${PROJECT}.${DEMO}.demo_search_policy_compare`
OPTIONS (description = "Demo workspace only: for each Search preference, the prospects it found (targeted) against the normal search in the same runs (baseline). Source: expelly_learning.search_policy_compare.")
AS
SELECT * EXCEPT (org_id)
FROM `${PROJECT}.${LEARN}.search_policy_compare`
WHERE org_id = '${DEMO_ORG_ID}';
