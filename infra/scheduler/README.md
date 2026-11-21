# Cloud Scheduler jobs for the learning loop (T13)

**Nothing here has been run.** These are Google Cloud changes. They wait until T08, T09, T10 and T13
are deployed (Aman, 2026-11-21), and each command is explained and approved before it runs.

## What it is

Three small time-based jobs. Cloud Scheduler calls an internal URL on the API on a timetable, with a
Google-signed identity. The API checks that identity (`apps/api/src/internal/cron-auth.guard.ts`) and
refuses everyone else.

| Job | When | Calls | What it does |
|---|---|---|---|
| `expelly-weekly-review` | Monday 06:00 Asia/Kolkata | `POST /internal/cron/weekly-review` | Recomputes every workspace's Review (new revision only if the numbers moved) and search preference results. Once per ISO week per workspace. |
| `expelly-expire-preferences` | every hour | `POST /internal/cron/expire-preferences` | Ends overdue search preferences, switches off unsafe ones. Safe to repeat. |
| `expelly-loop-health` | every 6 hours | `POST /internal/cron/loop-health` | Writes one `loop_health` JSON log line per workspace (the alerts read it). |

## Cost

Cloud Scheduler: **3 jobs free per billing account, then $0.10 per job per month**. These are 3 jobs,
so about **$0** if nothing else uses Scheduler. Each call is one small request to the API that is
already running (no extra instance).

Detection speed: `loop-health` every 6 hours means a stuck action is noticed within 6 hours by the
alerts. The Review screen strip shows it live. Making it every 30 minutes costs the same (the price is
per job, not per run); say so at deploy time if you want faster alerts.

## One-time setup

Variables (PowerShell). The project and region are the live ones.

```powershell
$P   = "supersaas-513613"
$R   = "asia-south1"
$API = "https://supersaas-api-108226687455.asia-south1.run.app"   # must be the URL the API answers on
$SA  = "expelly-scheduler@$P.iam.gserviceaccount.com"
```

### 1. Turn the API on (free)

```powershell
gcloud services enable cloudscheduler.googleapis.com --project=$P
```

Enables the Cloud Scheduler API. Creates nothing billable.

### 2. A service account for the scheduler (free)

```powershell
gcloud iam service-accounts create expelly-scheduler --display-name="Expelly scheduler" --project=$P
```

The identity Cloud Scheduler uses when it calls the API. It has no permissions yet.

### 3. Let it call the API (free)

```powershell
gcloud run services add-iam-policy-binding supersaas-api --region=$R --project=$P `
  --member="serviceAccount:$SA" --role="roles/run.invoker"
```

Grants `run.invoker` on the API service only. (The API is also reachable by the public today because
the web app and email links need it; the cron routes are protected by the API's own check, not by this.)

### 4. Tell the API who may call (a settings change, creates a new revision)

On the API service set:

| Setting | Value |
|---|---|
| `CRON_MODE` | `scheduler` (turns off the API's own timers for these three jobs, so each runs once) |
| `CRON_AUDIENCE` | the `$API` URL above |
| `CRON_SA_EMAIL` | `$SA` |

```powershell
gcloud run services update supersaas-api --region=$R --project=$P `
  --update-env-vars="CRON_MODE=scheduler,CRON_AUDIENCE=$API,CRON_SA_EMAIL=$SA"
```

The API refuses to start with `CRON_MODE=scheduler` if the other two are missing.

### 5. The three jobs (about $0)

```powershell
gcloud scheduler jobs create http expelly-weekly-review --location=$R --project=$P `
  --schedule="0 6 * * 1" --time-zone="Asia/Kolkata" `
  --uri="$API/internal/cron/weekly-review" --http-method=POST `
  --oidc-service-account-email=$SA --oidc-token-audience=$API `
  --attempt-deadline=600s --max-retry-attempts=2

gcloud scheduler jobs create http expelly-expire-preferences --location=$R --project=$P `
  --schedule="5 * * * *" --time-zone="Asia/Kolkata" `
  --uri="$API/internal/cron/expire-preferences" --http-method=POST `
  --oidc-service-account-email=$SA --oidc-token-audience=$API `
  --attempt-deadline=120s --max-retry-attempts=2

gcloud scheduler jobs create http expelly-loop-health --location=$R --project=$P `
  --schedule="10 */6 * * *" --time-zone="Asia/Kolkata" `
  --uri="$API/internal/cron/loop-health" --http-method=POST `
  --oidc-service-account-email=$SA --oidc-token-audience=$API `
  --attempt-deadline=120s --max-retry-attempts=2
```

Retries are safe: the weekly review does each workspace once per ISO week, and the other two are
idempotent.

## Check it works

```powershell
gcloud scheduler jobs list --location=$R --project=$P
gcloud scheduler jobs run expelly-expire-preferences --location=$R --project=$P   # run once now
gcloud logging read 'resource.type="cloud_scheduler_job"' --project=$P --limit=5 --format="value(timestamp,jsonPayload.status,httpRequest.status)"
```

A call without the right identity must return 401:

```powershell
curl.exe -s -o NUL -w "%{http_code}" -X POST "$API/internal/cron/loop-health"   # expect 401
```

## Roll back

```powershell
gcloud scheduler jobs pause expelly-weekly-review --location=$R --project=$P      # or delete
gcloud run services update supersaas-api --region=$R --project=$P --update-env-vars="CRON_MODE=internal"
```

`CRON_MODE=internal` puts the API's own timers back, so nothing is left without a caller.
