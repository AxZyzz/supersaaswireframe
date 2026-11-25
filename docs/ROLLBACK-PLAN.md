# Rollback plan (written before the next deploy, T18 section 4)

**Written:** 2026-11-23 · **Applies to:** the Expelly deployment on Google Cloud, project `supersaas-513613`, region
`asia-south1`. **Rule that never changes:** every `gcloud` command below is explained to Aman (what it does, what it
creates, what it costs) and run only after his go. Nothing here is run automatically.

## 1. What is live, and what each thing rolls back to (as of 2026-11-23)

| Thing | Live now | Roll back to |
|---|---|---|
| API (Cloud Run `supersaas-api`) | revision `supersaas-api-00026-548`, image `api:t17-3274050` | `supersaas-api-00025-qv2` (image `api:t16-bee86ea`) |
| Web (Cloud Run `supersaas-web`) | revision `supersaas-web-00016-cnc`, image `web:t17-3274050` | `supersaas-web-00015-lv2` (image `web:t16b-61061f2`) |
| Migration job `supersaas-migrate` | image `api:t17-3274050` | point it at the API image you want, run it only if a *new* migration is needed |
| Database | migrations `0001` to `0062` on Cloud SQL `supersaas-db` | **no down-migrations**: see section 3 |

The next deploy (waiting for billing, see `docs/RESTORE-RUNBOOK.md`) adds: the web "Send timing" layout (`65bf3a0`), the API
security fixes (`80fdafd`: simulate cap, BigQuery-route limits, a start-up warning) and test/docs commits. **It adds no
migration.** Its images are built from `google-stack` (today `9806aa0`); tag them `api:t18-<sha>` and `web:t18-<sha>`.

## 2. When to roll back (decide in minutes, not hours)

Roll back the **new revision** if, in the first 15 minutes after a deploy, any of these is true:

- `/health/ready` is not 200, or `db` or `redis` is false;
- `/login` or `/campaigns` do not load, or signed-in pages show errors;
- the new revision's logs show a burst of `ERROR` lines (not the single 401 line a probe causes);
- sends fail (`failed` outcomes in the tick log, or the Campaigns page stops updating);
- anything unexpected happens to email going out (wrong audience, a burst, a repeat). **Stop sending first** (section 5), then decide.

## 3. Rolling back code (safe, no data change)

Migrations in this project are **additive only** (new nullable columns, new tables; nothing dropped or renamed), so the
previous code runs fine against the newer schema: the old API ignores columns it does not know. That is why a code rollback
never needs a database change. **Never write or run a destructive migration as part of a rollback.**

1. **See the revisions:** `gcloud run revisions list --service=supersaas-api --region=asia-south1` (read-only, free).
2. **Send traffic back** (new revision stays, just gets 0%, so you can switch forward again):
   `gcloud run services update-traffic supersaas-api --region=asia-south1 --to-revisions=supersaas-api-00025-qv2=100`
   Same for the web service with its previous revision. Nothing is built or billed beyond the running service.
3. **Check:** `/health/ready` 200 (direct and through `/api/health/ready` on the web address), log in, open Campaigns.
4. If a revision must be removed for good, redeploy the old image instead:
   `gcloud run services update supersaas-api --region=asia-south1 --image=asia-south1-docker.pkg.dev/supersaas-513613/supersaas/api:<old tag>`

Roll the **web and API back together** only if the change spanned both; each can be rolled back alone (the web calls the API
through a stable `/api` proxy, and new fields are optional).

## 4. Rolling back a switch (no deploy of new code)

Most of the loop is behind flags on the API service. Turning one off is a new revision with one environment variable
changed: `gcloud run services update supersaas-api --region=asia-south1 --update-env-vars=NAME=value` (or
`--remove-env-vars=NAME`). Free; the old behaviour returns at once.

| Switch | On | Roll back to | What you lose by rolling back |
|---|---|---|---|
| `INSIGHTS_SOURCE` | `bigquery` | `postgres` | nothing visible: the page answers from Postgres (it already does if BigQuery errors) |
| `PLAYBOOK_SEARCH` | `bigquery` | `postgres` | playbook search drops to keywords (no vectors) |
| `EMBEDDINGS_USE_VERTEX` | `true` | remove it | embeddings stop; keyword search still works |
| `SAFETY_DRIVER` | `modelarmor` | `off` | prompt-injection screening off (the state before Model Armor is enabled) |
| `REVIEW_EXPLAINER` | `agent` or `gemini` | `template` | explanations become the plain template text (same numbers) |
| `COPYWRITER_DRIVER` | `agent` | `gemini` or `mock` | challenger drafts come from Gemini directly, or fixed templates |
| `DISCOVER_DRIVER` | `agent` | `native` | Discover runs on the API's own AI instead of the ADK agent |
| `CRON_MODE` | `scheduler` | `internal` | the API's own timers replace Cloud Scheduler (nothing is left without a caller) |
| `TRACING` | `on` | remove it | Cloud Trace spans stop |
| `SEND_STALE_AFTER_HOURS` | unset = **24** | `0` | the catch-up guard is off: a send overdue after an outage or a long pause goes out at once again (also `SEND_CATCHUP_SPREAD_HOURS`, default 24: how far ahead stale sends are spread) |
| `LOOKER_DASHBOARD_URL` | the report link | remove it | the operator console card disappears |

**Cloud Scheduler** (`expelly-weekly-review`, `expelly-expire-preferences`, `expelly-loop-health`): pause one with
`gcloud scheduler jobs pause <job> --location=asia-south1`; resume with `resume`. Pair a pause with `CRON_MODE=internal`
so the work still runs from the API (see `infra/scheduler/README.md`). **Datastream:** pause copying with
`gcloud datastream streams update expelly-learning-stream --location=asia-south1 --state=PAUSED` (Insights keep working
from Postgres). **Model Armor:** the template can stay; setting `SAFETY_DRIVER=off` is enough.

## 5. Emergency stop for email (do this first if anything looks wrong with sending)

In order of speed and how little they disturb:

1. **Pause the campaign** in the app (Campaigns, the pause button): new sends for it stop at once, history is kept.
2. **Pause every campaign of a workspace** from the operator console (`POST /operator/orgs/:id/pause-campaigns`).
3. **Stop the send loop for the whole API:** `gcloud run services update supersaas-api --region=asia-south1 --update-env-vars=SEND_SCHEDULER=off`
   (a new revision; nothing sends until you remove the variable; the rest of the app keeps working). `JOBS_SCHEDULER=off`
   stops the other background jobs.

Replies keep arriving and are read when the API runs again; tracking links and unsubscribe links keep working.

## 6. Data: what is and is not recoverable

- **Backups:** Cloud SQL automated daily backups were configured when the instance was created (start time 21:00).
  **A restore has not been rehearsed**, so treat it as a last resort and ask first: restoring rolls the whole database back
  to the backup time and loses everything after it.
- **Never needed for a code or flag rollback:** the database is not touched by sections 3 and 4.
- **BigQuery** (`expelly_raw`, `expelly_learning`, `expelly_memory`) is derived from Postgres and can be rebuilt; losing it
  loses no source data.

## 7. After any rollback

Write what happened and why in `docs/DEV-LOG.md` and the vault `_log.md`, keep the bad revision for the post-mortem (it
stays at 0% traffic), and add a test for whatever slipped through before deploying again.

## Not verified

None of these commands were run for this document; revision and image names come from the T16 and T17 deploy records.
Whether `update-traffic` behaves exactly as written in this project has not been exercised here (the T16 and T17 deploys
used `gcloud run services update --image`), and a Cloud SQL restore has never been tried.
