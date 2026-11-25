-- Learning Loop T14: where playbook VECTORS live.
--
-- Dataset `expelly_memory` is separate from `expelly_learning` on purpose: `expelly_learning` holds
-- only authorised views over the locked `expelly_raw` copy, and the API's service account only READS it.
-- Playbook vectors are written by the API, so they get their own small dataset with its own grant.
--
-- The table holds ids, the offer, the expiry and the vector. NO title, NO body, NO lead data: the text
-- stays in Postgres (the source of truth). Every statement the API runs filters or writes
-- `org_id = @org_id` (BigQuery has no row-level security here; that clause is the tenant wall, and the
-- API also re-checks every hit against Postgres).
--
-- Run (after Aman's go; replace PROJECT):
--   bq --location=asia-south1 mk --dataset --description "Playbook vectors (ids and numbers only)" PROJECT:expelly_memory
--   bq --location=asia-south1 query --use_legacy_sql=false < infra/bigquery/playbooks.sql      (with PROJECT replaced)
--
-- 768 numbers per row (gemini-embedding-001 cut to 768). No vector index: a brute-force scan over a few
-- hundred rows is cheaper and exact; add one only past ~5,000 rows.
CREATE TABLE IF NOT EXISTS `PROJECT.expelly_memory.playbook_vectors` (
  org_id      STRING    NOT NULL OPTIONS (description = 'Workspace. Every query filters on it.'),
  playbook_id STRING    NOT NULL OPTIONS (description = 'Playbook id in Postgres (the text lives there).'),
  version     INT64     NOT NULL OPTIONS (description = 'Playbook version this vector was made from.'),
  offer_id    STRING    NOT NULL OPTIONS (description = 'The offer the playbook is about. Retrieval filters on it.'),
  embedding   ARRAY<FLOAT64>     OPTIONS (description = 'gemini-embedding-001, 768 dimensions, document task type.'),
  valid_to    TIMESTAMP NOT NULL OPTIONS (description = 'After this the playbook is not retrieved.'),
  updated_at  TIMESTAMP NOT NULL OPTIONS (description = 'When this row was written.')
)
OPTIONS (description = 'Playbook vectors for VECTOR_SEARCH (Learning Loop T14). Ids and numbers only, no text.');
