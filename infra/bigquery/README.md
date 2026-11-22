# BigQuery learning plane (Learning Loop T07)

**Status:** set up on 2026-11-22 in project `supersaas-513613`, region `asia-south1` (Mumbai). See
"What is live" at the bottom for the exact state and what is not done.

## What it is (plain words)

Postgres (Cloud SQL) stays the source of truth: every decision, approval and count that matters is
computed there. This folder adds a **read-only copy of the analytics tables in BigQuery**, so the Insights
page, the search-policy comparison and dashboards can scan history without touching the live database.

```
Cloud SQL Postgres ──Datastream (copies changes, ~15 min behind)──► BigQuery expelly_raw   (locked down)
                                                                          │ views (authorised)
                                                                          ▼
                                                              BigQuery expelly_learning   (modelled views)
                                                                          │ reads, always WHERE org_id = @org_id
                                                                          ▼
                                                           API  INSIGHTS_SOURCE=bigquery  ──► Insights page
```

Decisions (A/B winners, approvals, search preferences) **never** read BigQuery.

## What is copied, and what is not

`replication-set.json` is the only list of tables and columns that leave Postgres. Three things enforce it:

1. Postgres: the `datastream_reader` role can `SELECT` only the listed **columns** (not whole tables), and the
   publication `expelly_bq` lists the same columns. So `to_email`, message text, lead names, evidence quotes
   and so on cannot be read by this role at all.
2. Datastream: the stream's include list is the same list, down to columns.
3. Jest (`apps/api/src/insights/replication-set.spec.ts`): fails the build if a PII-looking column is added, if
   the generated files are out of date, or if a view reads a table that is not replicated.

A column added by a later migration is **not** replicated until it is added to `replication-set.json` on purpose.

Known limits, said plainly:

- **JSON columns carry more than we need.** `campaign_leads.snapshot` and `prospects.triggers` contain the
  evidence quote and url of a buying trigger, and Datastream cannot trim inside a JSON column. `expelly_raw`
  is therefore treated as sensitive: only Datastream writes it, only the `expelly_learning` views read it
  (they are authorised on it), and the app's service account has **no** access to it. The views extract only
  whitelisted keys (never `quote` or `url`).
- **Free-mail company keys are email addresses** (`email:<address>`). They reach `expelly_raw` as they are; the
  views hash them with `safe_company_key()`, so nothing readable leaves `expelly_raw`.
- **Eligible (the Discover funnel) needs `prospects.emails`, which is not copied.** The Insights page reads that
  count from Postgres even in BigQuery mode; the BigQuery views say `became_lead` instead.
- **Not identical to Postgres mode:** `subject_length` is measured on the template text (rendered subjects are
  not copied), and old enrollments with no snapshot show "unknown" for lead-level factors.

## Files

| File | What |
|---|---|
| `replication-set.json` | The allow-list (source of truth) |
| `generate.js` | Turns it into `postgres-setup.sql` and `datastream-include.json` (`node infra/bigquery/generate.js`) |
| `postgres-setup.sql` | Role, column grants, publication, replication slot (generated) |
| `datastream-include.json` | Datastream include objects, down to columns (generated) |
| `views/*.sql` | The `expelly_learning` views and the `safe_company_key` function |
| `apply.sh` | Creates or replaces all views |

## One-time setup (run on 2026-11-22; every step was shown and approved first)

`P=supersaas-513613`, `R=asia-south1`. In Git Bash on Windows, set
`CLOUDSDK_PYTHON="D:/gcloudsdk/google-cloud-sdk/platform/bundledpython/python.exe"` first (`apply.sh` does it
for you), otherwise `bq` cannot find a Python.

| # | Step | Command (short) | Cost / effect |
|---|---|---|---|
| 1 | Turn the services on | `gcloud services enable datastream.googleapis.com bigquery.googleapis.com datalineage.googleapis.com dataplex.googleapis.com` | free |
| 2 | Two datasets | `bq mk --dataset --location=asia-south1 P:expelly_raw` and `P:expelly_learning` | free until data |
| 3 | Access | the API's service account `supersaas-run`: `roles/bigquery.jobUser` on the project and READER on `expelly_learning` only; `expelly_learning` authorised on `expelly_raw` (`bq show --format=prettyjson` -> edit `access` -> `bq update --source`). `bq add-iam-policy-binding` is not available on this project. | free |
| 4 | Logical decoding | `gcloud sql instances patch supersaas-db --database-flags=cloudsql.logical_decoding=on` | **restarts the DB, about 45 s** |
| 5 | Reader role, grants, publication, slot | `postgres-setup.sql`, run once as `postgres` through a short-lived Cloud Run job (same image and secrets as the migrate job; the job was deleted afterwards). Password is in Secret Manager `datastream-reader-password`. On Cloud SQL the `postgres` user has no REPLICATION, so the slot is created while acting as `datastream_reader`. | free |
| 6 | Let Datastream in | `gcloud sql instances patch supersaas-db --authorized-networks=<the 5 Datastream IPs for asia-south1 as /32>` (list: docs "IP allowlists and regions") | free, no restart |
| 7 | Connection profiles | `gcloud datastream connection-profiles create expelly-pg-source --type=postgresql ... --postgresql-secret-manager-stored-password=... --postgresql-ca-certificate="$(tr -d '\r' < ca.pem)" --static-ip-connectivity` and `expelly-bq-destination --type=bigquery` | free |
| 8 | Stream | `gcloud datastream streams create expelly-learning-stream ... --backfill-all` with a `singleTargetDataset` of `P:expelly_raw`, merge mode, `dataFreshness` 900s | Datastream bills per GB processed |
| 9 | Views | `PROJECT=$P infra/bigquery/apply.sh` | free |

Datastream's own robot (`service-<project number>@gcp-sa-datastream.iam.gserviceaccount.com`) needs
`secretmanager.secretAccessor` on `datastream-reader-password` and WRITER on `expelly_raw`.

## Cost

Datastream charges per GB of change data and backfill it processes. At our volume (thousands of rows) that is
cents to a few dollars a month; the backfill is one-time. BigQuery storage and queries are inside the free
tier (10 GB storage, 1 TB queries a month); every app query is capped at 1 GiB billed
(`BIGQUERY_MAX_BYTES`). Views cost nothing until queried.

## Turning it on and off

- On: set `INSIGHTS_SOURCE=bigquery` on the API (and `GOOGLE_CLOUD_PROJECT`, already set). The Insights page then
  shows "Data as of <time>". If BigQuery fails, the page answers from Postgres and logs
  `insights: bigquery failed, answering from postgres`.
- Off: `INSIGHTS_SOURCE=postgres` (the default). Nothing else changes.
- Pause copying: `gcloud datastream streams update expelly-learning-stream --location=asia-south1 --state=PAUSED`.
- **Do not delete the stream and leave the slot behind.** An unused replication slot makes Postgres keep its log
  files forever and can fill the disk. To remove everything for good: delete the stream, then run
  `SELECT pg_drop_replication_slot('expelly_bq_slot');` as `datastream_reader`.

## Plan B (if Datastream is ever blocked)

A BigQuery connection to Cloud SQL plus federated `EXTERNAL_QUERY` views, with the same view names under
`expelly_learning`, so the app code does not change. There is no replication: every query hits Cloud SQL live,
so it is only for small volumes. Not built: ask before switching.

## Checking it works

```bash
# every column in expelly_raw (no to_email, no message text, ...)
bq show --schema --format=prettyjson supersaas-513613:expelly_raw.public_sent_emails
# the numbers, compared with Postgres (needs the production database URL, see the script header)
npm run bq:smoke -w apps/api -- --compare
```

## Glossary and lineage (Knowledge Catalog)

`PROJECT=supersaas-513613 node infra/bigquery/glossary.js` creates the **Expelly metrics** glossary (10 terms, definitions copied
from the Campaign Review Build Brief) in `asia-south1` and links each term to the view columns it describes (for example
*Qualified reply (verified)* to `company_reach.qualified_verified`). It only creates what is missing; links to a view that does not
exist yet are skipped, so run it again after `apply.sh` creates `review_history` and `search_policy_compare`.
Descriptions on every view and column are part of the view SQL.

**Lineage** is recorded automatically because the Data Lineage API is on (Google says a job shows up within 24 hours; ours
showed up within minutes). Chain recorded 2026-11-22:
`expelly_raw.public_outcome_events` -> `outcomes_current` -> `company_reach` -> `factor_funnel`, plus the raw tables each view reads.
Open it in the console: Knowledge Catalog -> search `factor_funnel` -> Lineage tab (or BigQuery Studio -> the view -> Lineage).
Screenshot: `docs/architecture/t07-lineage-factor-funnel.jpg`.

## What is live (2026-11-22)

- Datastream stream `expelly-learning-stream`: RUNNING, 17 tables backfilled with no errors, 15-minute freshness.
  Datastream creates a table in `expelly_raw` on its first row, so `public_reviews`, `public_review_actions` and
  `public_search_preferences` do not exist yet (production has none of those rows). `apply.sh` skips the two views that need them
  (`review_history`, `search_policy_compare`); run it again later.
- 8 of the 10 view files applied. Row counts on 2026-11-22: 4 workspaces, 18 sent emails, 7 campaigns, 39 outcome events.
- `INSIGHTS_SOURCE=bigquery` in production since 2026-11-22 (API revision 00021); Postgres answers if BigQuery fails.
- Known gap: a workspace whose enrollments were made before snapshots existed (T02) has sends but no company key in BigQuery
  (the Postgres source falls back to the leads table, which is not copied). New enrollments are fine.

## Playbook vectors (Learning Loop T14)

Separate from everything above: dataset `expelly_memory` (`asia-south1`) holds one table, `playbook_vectors` (ids, offer, expiry and the vector; no text).
It is written by the API, which is why it is not in `expelly_learning` (views only, read-only to the API). DDL: `playbooks.sql`. Playbooks are NOT in `replication-set.json`.

- Created 2026-11-22: dataset, empty table, and `WRITER` for `supersaas-run@supersaas-513613.iam.gserviceaccount.com` on this dataset only (dataset ACL edited with `bq show` then `bq update --source`, as for `expelly_learning`).
- Still to do: enable Vertex AI and `roles/aiplatform.user`, run `npm run playbooks:smoke` as a temporary Cloud Run job, then `PLAYBOOK_SEARCH=bigquery`. Details: `docs/GOOGLE-STACK.md` Phase 5.
