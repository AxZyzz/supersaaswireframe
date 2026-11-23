# Restore-day runbook: bringing Expelly back after the billing closure

**Written:** 2026-11-23 · **Project:** `supersaas-513613` (number `108226687455`), region `asia-south1`.
**Why this exists:** on 2026-11-23 (about 03:34 UTC) the Google Cloud billing account for the project was found **closed**.
`gcloud builds submit` was refused ("billing account … is disabled in state closed") and the live site returned Google
500/503 pages. Cause not confirmed. Nothing in the cloud can be checked or changed until billing is restored.
**Standing rule:** every `gcloud` command here is explained (what it does, what it creates, what it costs) and run only after
Aman's go. Read-only checks (describe, list, `curl` on the health URLs) are free.

## 0. What is down while billing is closed, and what is not

| Down or unreachable | Why it matters |
|---|---|
| Web and API (Cloud Run), so the app, login, tracking and unsubscribe links, the 30-second send loop, Gmail reply sync | no sends, no replies read, open/click tracking returns an error page |
| Cloud SQL (probably stopped or suspended: **not verified**) | the data is the only copy of the workspace |
| Cloud Scheduler jobs, Datastream, Cloud Build, Artifact Registry (images), Secret Manager | cannot be changed; may be disabled |

Not affected: the git repository (GitHub), the vault, and the Redis used by the app (Upstash, a separate provider; it may
have kept state or expired keys). **Not verified:** what Google does to resources the longer billing stays closed. Treat
every day as a risk to the data and restore billing first.

## 1. Aman: restore billing (only he can)

1. Google Cloud Console, **Billing**, open the billing account that was on `supersaas-513613`. Read why it is closed
   (free-trial credit ended, payment failed, closed by someone).
2. Reopen it, or add a payment method and link an **open** billing account to the project (Billing, Account management,
   Link a billing account).
3. Tell me when the project shows billing enabled. I do not touch billing, payment methods or accounts.

## 2. First checks, read-only (I run these once Aman says billing is back)

```
gcloud billing projects describe supersaas-513613                       # billingEnabled should be true
gcloud sql instances describe supersaas-db --format="value(state)"      # RUNNABLE, or STOPPED / SUSPENDED
gcloud run services list --region=asia-south1                           # supersaas-api, supersaas-web
curl -s https://supersaas-api-108226687455.asia-south1.run.app/health/ready     # {"status":"ok","checks":{"db":true,"redis":true}}
gcloud scheduler jobs list --location=asia-south1                       # 3 jobs: expelly-weekly-review, -expire-preferences, -loop-health
gcloud datastream streams describe expelly-learning-stream --location=asia-south1 --format="value(state)"   # RUNNING
gcloud secrets list --format="value(name)"                              # the secrets still exist
gcloud artifacts docker images list asia-south1-docker.pkg.dev/supersaas-513613/supersaas   # images still there
gcloud services list --enabled | findstr /i "run sql cloudbuild secretmanager artifactregistry"
```

Write the results in the DEV-LOG. **If a Cloud SQL instance, a secret or an image is gone, stop and tell Aman before doing
anything else**: that changes the plan (a restore from backup, or a rebuild, both need his decision).

## 3. Bring the database up (if it is not RUNNABLE)

`gcloud sql instances patch supersaas-db --activation-policy=ALWAYS` starts a stopped instance (a few minutes; billed as
before, about $10 to 14 a month for `db-f1-micro`). Wait for `RUNNABLE`. Do not restore from backup unless the instance or
its data is actually missing, and then only after Aman decides (a restore rolls the whole database back to the backup time).

## 4. The overdue-email problem (decide this BEFORE the API runs)

While the API was down, every active campaign's next email went overdue. The moment the API runs again its send loop
(every 30 seconds, up to 200 leads a tick) starts working through them. Limits that still apply: each sender's daily cap and
warm-up, the plan's email caps, suppression and unsubscribes, and a campaign's send window if it has one. **None of the
existing campaigns has a send window**, so late emails can go out at any hour.

**Cannot be prevented from our side if the API restarts by itself the moment billing returns** (Cloud Run keeps one instance
running). If that happens the first ticks may already be sending when we look. To reduce the risk:

1. As soon as billing is back, before anything else, set the stop switch:
   `gcloud run services update supersaas-api --region=asia-south1 --update-env-vars=SEND_SCHEDULER=off`
   (a new revision; nothing sends until the variable is removed; replies and the app still work).
2. Check `/health/ready`, sign in, and open each active campaign. Decide per campaign: **pause it**, or let it continue.
3. Look at how overdue things are (Campaigns, the Performance numbers and "Run due sends" count; the operator console shows
   failures and daily sends).
4. Resume sending: pause what should stay paused first, then
   `gcloud run services update supersaas-api --region=asia-south1 --remove-env-vars=SEND_SCHEDULER`.

**Effects to tell Aman:** emails will go out late (after the outage); replies that arrive more than 14 days after a company's
first send are stored but not counted by Review (the response window), so any running test loses days; a send-time test's
windows are respected, a plain campaign's are not. If Aman wants a protection against overdue bursts after future outages,
that is a small change to the send path (skip or spread leads overdue by more than N hours): ask before restore day.

## 5. Check the running system (read-only, then sign in)

1. `/health/ready` is 200 with `db` and `redis` true, directly and through the web address (`/api/health/ready`).
2. Aman signs in himself (I do not type his password), opens Campaigns, selects a campaign: the Setup tab loads.
3. Gmail reply sync works: the Inbox should show replies that arrived during the outage. This has not been checked for a
   gap this long: if some are missing, tell me and I will look at how far back the sync reads.
4. Logs for the last 15 minutes have no `ERROR` lines: `gcloud logging read 'resource.type="cloud_run_revision" AND severity>=ERROR' --limit=10 --freshness=15m`.
5. Scheduler jobs are `ENABLED`; the three loop routes answer 401 without a token.
6. Datastream is `RUNNING`; Insights answers (it falls back to Postgres if BigQuery does not).

## 6. Deploy what is waiting (needs Aman's go, one command at a time)

Waiting since 2026-11-23, no migration: the web **Send timing** layout (`65bf3a0`), the API **security fixes** (`80fdafd`: the
simulate cap, the BigQuery-route limits, the Model Armor start-up warning), tests and docs. Build from a clean checkout of
`google-stack` (today `9806aa0`):

1. `gcloud builds submit --region=asia-south1 --config deploy/cloudbuild-api.yaml --substitutions=_IMAGE=asia-south1-docker.pkg.dev/supersaas-513613/supersaas/api:t18-<sha> .` (about 5 minutes, free tier)
2. `gcloud run jobs update supersaas-migrate --region=asia-south1 --image=...api:t18-<sha>` then `gcloud run jobs execute supersaas-migrate --region=asia-south1 --wait` (expect "migrations applied", no new migration)
3. `gcloud run services update supersaas-api --region=asia-south1 --image=...api:t18-<sha>` (rollback: `docs/ROLLBACK-PLAN.md`)
4. `gcloud builds submit --region=asia-south1 --config deploy/cloudbuild-web.yaml --substitutions=_IMAGE=...web:t18-<sha>,_API_URL=https://supersaas-api-108226687455.asia-south1.run.app .` (about 3 minutes)
5. `gcloud run services update supersaas-web --region=asia-south1 --image=...web:t18-<sha>`
6. Checks as in section 5, plus: Campaigns, Setup tab, **Send timing** sits directly under Performance.

## 7. Then the open security item: turn Model Armor on (own go, see `infra/model-armor/README.md`)

Create the Model Armor template `expelly-safety` (region `us-central1`), give the API's service account
`roles/modelarmor.user`, then set `SAFETY_DRIVER=modelarmor`, `MODEL_ARMOR_TEMPLATE=expelly-safety`,
`MODEL_ARMOR_LOCATION=us-central1`, `GOOGLE_CLOUD_PROJECT=supersaas-513613`, and decide `SAFETY_FAIL_MODE` (`open` keeps the
app available if Model Armor is down; `closed` refuses instead). The app refuses to boot without the template, so create it
first. Cost: free for the first 2 million tokens a month, then $0.10 per million. Roll back with `SAFETY_DRIVER=off`. After it
is on, the `AiSafety` start-up warning disappears from the logs.

## 8. Still pending after the restore (each its own go and cost decision)

- **Agent Engine deploy** of the three agents (Review analyst, Copywriter, Discover), Agent Registry and the one Cloud
  Trace across API and agent: postponed on 2026-11-21 because it costs money (see `apps/agents/deploy/README.md`).
- **T18 live end-to-end run** and its smoke test, once the above is healthy.
- Verify an alert actually emails, a real calendar booking and cancel, a real send-time test with real replies.

## 9. When done

Update `docs/DEV-LOG.md`, the vault `_log.md` and the Tasks Index (what was found, what was run, revisions), and delete the
memory note `project-gcp-billing-closed-2026-11-23` (it is only true until billing is restored).
