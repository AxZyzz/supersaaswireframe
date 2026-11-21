# Deploying SuperSaaS to Google Cloud (Cloud Run + Cloud SQL, Mumbai)

What each piece is, why it's there, what it costs, and the exact commands.
Region everywhere: **`asia-south1` (Mumbai)**. Decided 2026-11-19.

```
 Browser ──https──► supersaas-web (Cloud Run, Next.js)
                        │  /api/*  (proxied, so login cookies are first-party)
                        ▼
 Mail apps ──https──► supersaas-api (Cloud Run, NestJS: REST + websocket + workers, always on)
 (pixel, clicks,        │                 │                    │
  unsubscribe)          ▼                 ▼                    ▼
                  Cloud SQL Postgres   Upstash Redis       Gmail / Gemini / SMTP
                  (private socket)     (TLS, Mumbai)
 Secrets: Secret Manager · Images: Artifact Registry · Builds: Cloud Build
```

## Glossary (one line each)

| Thing | What it is |
|---|---|
| **Project** | A folder in Google Cloud that holds everything and is linked to a billing account |
| **Cloud Run service** | Runs one of our Docker images and gives it an `https://…run.app` address |
| **Cloud Run job** | Runs an image once and stops (we use it for database migrations) |
| **Cloud SQL** | Google-managed Postgres: backups, patches, storage handled for us |
| **Artifact Registry** | Private storage for our Docker images |
| **Cloud Build** | Google builds the Docker images in the cloud (your laptop doesn't need to) |
| **Secret Manager** | Encrypted storage for passwords/keys; Cloud Run reads them at start-up, they never sit in code or chat |
| **Service account** | A robot identity the API runs as, given only the permissions it needs |
| **Upstash** | Managed Redis (separate company, Mumbai region on AWS); holds job queues + rate limits |

## Monthly cost (estimates, Mumbai, check the pricing calculator)

| Piece | Setting | ≈ / month |
|---|---|---|
| API on Cloud Run | 1 vCPU, 1 GiB, always on (`--min-instances=1 --no-cpu-throttling`) | $40–50 |
| Web on Cloud Run | scales to zero | ~$0 (free tier) |
| Cloud SQL | `db-f1-micro`, 10 GB SSD, daily backups | $10–14 |
| Upstash Redis | pay-as-you-go or $10 fixed plan | $0–10 |
| Secret Manager, Artifact Registry, Cloud Build | small | ~$1 |
| **Total** | | **≈ $50–75** |

Gemini (AI Studio key) is billed separately by Google AI Studio.

## Prerequisites (Aman, once)

1. **gcloud CLI** installed and signed in:
   ```powershell
   winget install --id Google.CloudSDK
   ```
   Open a new terminal, then:
   ```powershell
   gcloud auth login
   ```
2. Know the **project ID** (the project that already holds the Gmail OAuth client) and the
   **billing account** from the buildathon (`gcloud billing accounts list`).
3. In the console: Billing → Budgets & alerts → a budget with alerts at 50/90/100 %.
4. **Upstash**: create account → Redis database → region **ap-south-1 (Mumbai)**, TLS on →
   copy the `rediss://…` URL into the local `.env` as `PROD_REDIS_URL=` (never into chat).
5. System email: put the working SMTP password in `.env` as `PROD_SYSTEM_SMTP_PASS=`
   (Gmail app password, or Brevo SMTP key).

## Steps (Claude runs these, each shown + approved first)

Variables used below: `P` = project ID, `N` = project number, `R=asia-south1`,
`IMG=$R-docker.pkg.dev/$P/supersaas`.

| # | Step | Command (short) | Creates / costs |
|---|---|---|---|
| 1 | Point gcloud at the project, link billing | `gcloud config set project P` · `gcloud billing projects link P --billing-account=…` | nothing billable yet |
| 2 | Turn on the services | `gcloud services enable run.googleapis.com sqladmin.googleapis.com artifactregistry.googleapis.com cloudbuild.googleapis.com secretmanager.googleapis.com` | free |
| 3 | Image storage | `gcloud artifacts repositories create supersaas --repository-format=docker --location=R` | ~cents |
| 4 | Database server (5–10 min) | `gcloud sql instances create supersaas-db --database-version=POSTGRES_16 --edition=ENTERPRISE --tier=db-f1-micro --region=R --storage-size=10 --backup-start-time=21:00` | **$10–14/mo** |
| 5 | Database + owner password | `gcloud sql databases create supersaas --instance=supersaas-db` · `gcloud sql users set-password postgres …` (random, straight into Secret Manager) | free |
| 6 | Secrets | `gcloud secrets create … --data-file=-` for: DB URLs, app-role password, JWT secrets, encryption key, Redis URL, Gemini key, Google client secret, SMTP password. Generated ones are created by a script and never printed | ~cents |
| 7 | Robot identity | service account `supersaas-run` with `roles/cloudsql.client` + `roles/secretmanager.secretAccessor` | free |
| 8 | Build images | `gcloud builds submit --config deploy/cloudbuild-api.yaml …` then the web one with `_API_URL` | free tier minutes |
| 9 | Create tables | Cloud Run job `supersaas-migrate` (same API image, `node dist/src/db/migrate.js`), run with `--wait` | free |
| 10 | Deploy API | `gcloud run deploy supersaas-api --min-instances=1 --max-instances=1 --no-cpu-throttling --cpu=1 --memory=1Gi --timeout=3600 --add-cloudsql-instances=P:R:supersaas-db …` | **$40–50/mo** |
| 11 | Deploy web | `gcloud run deploy supersaas-web --min-instances=0 …` | ~$0 |
| 12 | Google sign-in (Aman, console) | OAuth client → add redirect URI `https://supersaas-web-N.R.run.app/api/auth/google/callback`; OAuth consent → test users | free |
| 13 | Make Aman operator | job run of `node dist/scripts/operator.js grant <email>` | free |
| 14 | Live test | sign up → connect Gmail → campaign to 2nd account → open, click, reply → password reset | |

Cloud Run addresses are predictable: `https://SERVICE-N.R.run.app`, so the web
build can be given the API address before the API exists.

### API settings (non-secret env)

`NODE_ENV=production` · `WEB_URL=https://supersaas-web-N.R.run.app` ·
`API_URL=https://supersaas-api-N.R.run.app` (tracking + unsubscribe links) ·
`COOKIE_PATH_PREFIX=/api` · `GOOGLE_OAUTH_REDIRECT_URL=<WEB_URL>/api/auth/google/callback` ·
`TRUST_PROXY` (set after checking forwarded IPs) · `AI_DRIVER=gemini` ·
`GOOGLE_CLIENT_ID` · `SYSTEM_SMTP_HOST/PORT/SECURE/USER`, `SYSTEM_EMAIL_FROM` · `SIGNUP_MODE`.

### Why these choices

- **API always on, max 1 instance:** the 30-second send scheduler, the 2-minute Gmail
  sync and BullMQ workers run inside the API, so CPU must not be paused between
  requests. One instance is plenty for beta; schedules are shared through Redis, so it
  can scale out later.
- **Web proxies `/api`:** two `*.run.app` hosts count as different sites, and Safari
  blocks cross-site cookies; through the proxy the login cookie is first-party. The
  websocket goes straight to the API (it authenticates with the access token, no cookie).
- **Cloud SQL owner is not a superuser:** migration `0046` adds an owner-only policy so
  the cross-tenant database functions (login, scheduler, reply sync) still work. Proven
  locally against a non-superuser database before deploying.
- **`supersaas_app` gets a real password** from Secret Manager at migration time
  (`APP_DB_PASSWORD`); the dev password in migration 0002 never reaches production.

## Updating later

Rebuild the changed image (step 8), re-run the migrate job if there are new
migrations (step 9), then `gcloud run deploy` with the new image tag.
Rollback: deploy the previous image tag.
