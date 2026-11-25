CREATE OR REPLACE VIEW `${PROJECT}.${LEARN}.data_freshness` (
  org_id OPTIONS (description = "Workspace (tenant). Every query must filter on it."),
  last_change OPTIONS (description = "Data as of: the newest database change from this workspace (a send, an event, an outcome or an enrollment) that has reached BigQuery. If the workspace is quiet this stays old even though BigQuery is fully caught up. Updates arrive within about 15 minutes.")
)
OPTIONS (description = "Replication freshness per workspace, shown as Data as of on the Insights page. Computed from the Datastream commit time of the newest replicated rows. Sources: sent_emails, email_events, outcome_events, campaign_leads.")
AS
SELECT org_id, MAX(changed_at) AS last_change
FROM (
  SELECT org_id, MAX(TIMESTAMP_MILLIS(datastream_metadata.source_timestamp)) AS changed_at
  FROM `${PROJECT}.${RAW}.public_sent_emails` GROUP BY org_id
  UNION ALL
  SELECT org_id, MAX(TIMESTAMP_MILLIS(datastream_metadata.source_timestamp))
  FROM `${PROJECT}.${RAW}.public_email_events` GROUP BY org_id
  UNION ALL
  SELECT org_id, MAX(TIMESTAMP_MILLIS(datastream_metadata.source_timestamp))
  FROM `${PROJECT}.${RAW}.public_outcome_events` GROUP BY org_id
  UNION ALL
  SELECT org_id, MAX(TIMESTAMP_MILLIS(datastream_metadata.source_timestamp))
  FROM `${PROJECT}.${RAW}.public_campaign_leads` GROUP BY org_id
)
GROUP BY org_id;
