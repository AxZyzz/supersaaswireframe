# Live database on Supabase (since 2026-11-20)

The live API's Postgres moved from Google Cloud SQL to **Supabase (free plan)** on
2026-11-20, so the buildathon build no longer depends on Google Cloud credits for its
database. API + web still run on Cloud Run (see [DEPLOY-GCP.md](DEPLOY-GCP.md)); only the
database changed. Started fresh (no data copied from Cloud SQL).

```
 supersaas-api (Cloud Run, Mumbai) ──TLS, verify-full──► Supavisor session pooler (IPv4)
                                                         aws-0-ap-northeast-2.pooler.supabase.com:5432
                                                                   │
                                                                   ▼
                                                     Supabase Postgres 17 (Seoul, project vxlktlwschxxbkuuxwwh)
```

## Facts

| Thing | Value |
|---|---|
| Project ref | `vxlktlwschxxbkuuxwwh` (Supabase MCP in `.mcp.json` points at it) |
| Region | **Northeast Asia (Seoul), `ap-northeast-2`**. Kept by Aman's choice; regions can't be changed. Each DB round trip from Mumbai costs ≈100 ms+ |
| Postgres | 17, Nano compute, 60 max connections |
| Connection | Session pooler, port 5432 (IPv4; direct connections are IPv6-only on free) |
| App role | `supersaas_app` → user `supersaas_app.vxlktlwschxxbkuuxwwh` (NOSUPERUSER, NOBYPASSRLS). Supavisor accepts this custom role directly; no workaround needed. The transaction pooler (6543) also works, because all tenant state is transaction-local |
| Owner role | Supabase `postgres` (not a superuser; has CREATEROLE + BYPASSRLS). Runs migrations |
| TLS | `?sslmode=verify-full&sslrootcert=/repo/apps/api/supabase-ca.crt`. The CA is `deploy/supabase-ca.crt` ("Supabase Root 2021 CA", valid to 2031), copied into the API image by `apps/api/Dockerfile`. Without it node-postgres fails with `SELF_SIGNED_CERT_IN_CHAIN` |

## Secrets (Secret Manager, project `supersaas-513613`)

| Secret | Version | Points at |
|---|---|---|
| `database-url` | **2** = Supabase (`supersaas_app` via pooler) · 1 = old Cloud SQL socket | API |
| `migrate-database-url` | **2** = Supabase (`postgres` via pooler) · 1 = old Cloud SQL | `supersaas-migrate` job |
| `app-db-password` | unchanged | `migrate.ts` sets `supersaas_app`'s password from it |

Services read `latest`. Both `supersaas-api` and the `supersaas-migrate` job had the Cloud
SQL attachment removed (`--clear-cloudsql-instances`). **Any API image must be built from a
commit at or after `954f2cb`** (it carries the CA file), or it can't connect.

## Data API lockdown

Supabase publishes `public` through its Data API and grants every new table/function to
`anon`, `authenticated` and `service_role`. SuperSaaS never uses the Data API, and tables
without RLS (`users`, `refresh_tokens`, …) would be readable with the public key.

- Migration `0049_supabase_lockdown` revokes all table/sequence/function privileges and
  default privileges of those three roles in `public` (no-op where they don't exist).
- `src/db/migrate.ts` re-applies it after every run, like `owner_bypass`.
- Verified 2026-11-20: 0 grants left; dashboard shows "0 of 37 tables / 0 of 18 functions
  exposed"; with the publishable key `GET /rest/v1/users`, `/refresh_tokens` and
  `POST /rest/v1/rpc/operator_orgs` all return 401 `permission denied`; GraphQL disabled;
  security advisor clean.
- Belt and braces (Aman, optional): Integrations → Data API → turn it off.

## Running migrations

Normal path: build the image, then
`gcloud run jobs update supersaas-migrate --region=asia-south1 --image=<new image>` and
`gcloud run jobs execute supersaas-migrate --region=asia-south1 --wait`.

From a laptop (owner URL from `.env` `PROD_SUPABASE_URL`, local CA path):
```bash
export MIGRATE_DATABASE_URL="$PROD_SUPABASE_URL?sslmode=verify-full&sslrootcert=<abs path>/deploy/supabase-ca.crt"
export APP_DB_PASSWORD="$(gcloud secrets versions access latest --secret=app-db-password)"
npm run db:migrate:prod -w apps/api
```

## Free-plan limits

- **500 MB database.** Watch the dashboard's Disk figure.
- **No automatic backups** (Pro plan only). Take manual ones before risky changes:
  `pg_dump "$MIGRATE_DATABASE_URL" -Fc -f supersaas-$(date +%F).dump`, run with the
  `postgres:17` Docker image, since local `pg_dump` isn't installed.
- **Pause after a week of low activity.** Supabase says "a few user requests to the database
  each day" prevents it, and it emails a warning about a week before. The API's 30-second
  scheduler queries the DB constantly, so it should never trigger. If it ever pauses:
  Dashboard → project → *Resume project* (data kept, restorable for a year).
- **Pooler:** about 15 pooled connections; the API's `pg` pool defaults to 10, the migrate job uses 1.

## Rollback to Cloud SQL (only while `supersaas-db` still exists)

```bash
gcloud run services update supersaas-api --region=asia-south1 \
  --image=asia-south1-docker.pkg.dev/supersaas-513613/supersaas/api:07c2281 \
  --add-cloudsql-instances=supersaas-513613:asia-south1:supersaas-db \
  --update-secrets=DATABASE_URL=database-url:1
```
(and the same for the migrate job with `MIGRATE_DATABASE_URL=migrate-database-url:1`).
Cloud SQL holds the pre-move data; anything created on Supabase would not carry back.
