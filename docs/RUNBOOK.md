# SuperSaaS runbook (T10.8)

Operational guide for running, deploying, restoring and debugging SuperSaaS.
Hosting (decision D-C) isn't chosen yet, so deploy steps are written for "a
Linux host running Node 22 + managed Postgres 16 + Redis 7"; adapt the
commands to the platform once chosen. Last reviewed 2026-11-03.

## 1. Architecture at a glance

| Piece | What | Notes |
|---|---|---|
| `apps/web` | Next.js 15 frontend | Static marketing pages + client app. Deployed on Vercel (root dir `apps/web`). Needs `NEXT_PUBLIC_API_URL` at **build** time. |
| `apps/api` | NestJS 11 API + workers | One process serves HTTP, Socket.io (`/realtime`) and BullMQ workers (CSV import, segment refresh, send scheduler). |
| Postgres 16 | All data | Row-level security on every tenant table. App connects as `supersaas_app` (restricted); migrations run as the owner role. |
| Redis 7 | Queues + realtime fan-out | BullMQ jobs, the 30s send scheduler, Socket.io Redis adapter. Losing Redis loses queued jobs, not data. |

Send pipeline: the scheduler (every 30s) asks Postgres which leads are due,
then each lead is **claimed with a 10-minute lease** before sending, so
overlapping ticks or multiple API instances never double-send. Daily/monthly
plan caps defer sends; they're never dropped.

## 2. Environment variables

Full list with comments: `.env.example`. The API **refuses to boot in
production** if any of these are wrong (see `apps/api/src/config/env.validation.ts`):

- `DATABASE_URL` (app role), `MIGRATE_DATABASE_URL` (owner role, migrations only)
- `REDIS_URL`, `WEB_URL`, `API_URL`
- `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`: random, ≥32 chars, different from each other
- `APP_ENCRYPTION_KEY`: 64 hex chars (encrypts sender credentials)
- `EMAIL_DRIVER` must not be `mock`; `THROTTLE_DISABLED` must not be set
- Optional: `TRUST_PROXY` (hop count behind a load balancer), `SWAGGER=on`,
  `SEND_SCHEDULER=off` (disable the scheduler on an instance), `AI_DRIVER=bedrock`
- Sessions: the refresh token is an httpOnly, Secure cookie scoped to `/auth`;
  the access token lives only in page memory. Serve web and API from the same
  site (e.g. `app.` + `api.` subdomains) so the default `COOKIE_SAMESITE=lax`
  works. Unrelated domains need `COOKIE_SAMESITE=none`. CORS allows only `WEB_URL`.

Generate secrets:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

## 3. Local development

```bash
npm ci
docker compose up -d                # Postgres + Redis
npm run db:migrate -w apps/api
npm run dev:api                     # :4000
npm run dev:web                     # :3000
```

- Tests: `npm test -w apps/api` (needs Docker) · browser E2E: `npm run e2e -w apps/e2e`
- AI quality: `npm run eval -w apps/api` (mock = pipeline check; `AI_DRIVER=bedrock` = real scores)
- **Docker Desktop won't start on Windows** ("cannot remove … dockerInference / engine.sock"):
  quit Docker, `wsl --shutdown`, rename `%LOCALAPPDATA%\Docker\run` and
  `%LOCALAPPDATA%\docker-secrets-engine` to `*.stale-<n>`, relaunch. Repeat once if the
  second socket fails. Then `docker start supersaas-postgres supersaas-redis`.

## 4. Deploying

Order matters: **migrate → API → web**.

1. CI must be green on `main` (lint, unit+integration tests, build, browser E2E, critical audit).
2. Back up the database (section 5) before any migration.
3. Run migrations with the owner role:
   ```bash
   MIGRATE_DATABASE_URL=... npm run db:migrate -w apps/api
   ```
   Migrations are additive (new columns default safely), so the old API keeps
   working against the new schema during the rollout.
4. Build and start the API:
   ```bash
   npm ci && npm run build -w apps/api
   NODE_ENV=production npm run start:prod -w apps/api
   ```
   Run it under a supervisor (systemd/PM2/container) with restart-on-failure.
   Multiple instances are safe: the send lease prevents double sends and the
   Redis adapter shares realtime events and rate-limit counters (keys
   `throttle:*`; fails open if Redis blips). The load balancer must allow
   WebSockets (the client uses the WebSocket transport only, so no sticky
   sessions are needed). Set `TRUST_PROXY=1` so rate limits see client IPs.
5. Verify: `GET /health/ready` returns `{"status":"ok"}` (503 = DB or Redis unreachable).
6. Deploy the web app (Vercel builds from `main`; `NEXT_PUBLIC_API_URL` must point at the API).
7. Smoke test: sign in, open the dashboard, open the Operator console → System health all green.

**Rollback:** redeploy the previous API/web build. Don't roll back migrations;
they're additive. If a migration itself is broken, restore the pre-deploy
backup (section 5).

## 5. Backups and restore

Postgres holds everything that matters; Redis is rebuildable.

```bash
# backup (owner role), compressed custom format
pg_dump "$MIGRATE_DATABASE_URL" -Fc -f supersaas-$(date +%F-%H%M).dump

# restore into an EMPTY database
pg_restore -d "$MIGRATE_DATABASE_URL" --no-owner --role=supersaas supersaas-YYYY-MM-DD-HHMM.dump
npm run db:migrate -w apps/api     # bring it up to the current schema
```

- Use the managed provider's automated daily backups + point-in-time recovery once hosting is chosen. Test a restore monthly.
- After restoring, check the `supersaas_app` role still has its grants (migration `0002_app_role.sql`).

## 6. Operator tasks

```bash
npm run operator -w apps/api -- grant you@a2b.ai     # cross-tenant console access
npm run operator -w apps/api -- revoke you@a2b.ai
npm run operator -w apps/api -- list
```

- **Beta invites:** set `SIGNUP_MODE=waitlist` on the API. Sign-up then needs an invite; visitors join the waitlist instead. In the operator console, *Approve* a waitlist entry to get a single-use link bound to that email, and send it from your inbox. Feedback from the in-app button shows up next to the waitlist.
- **Operator console** (`/operator` in the app): workspaces, sends, failures, queue health; switch a workspace between `beta` and `internal` (unlimited).
- **GDPR requests** are self-service: export in Settings → Data & privacy, Lead → Forget for one person, Delete workspace/account. If a requester can't log in, an operator can act on their behalf (verify identity first).

## 7. Incident playbooks

**API down / 503 on `/health/ready`**: check which check failed (`checks.db` / `checks.redis`). The browser keeps users signed in during outages; they see "Can't reach the server". Restart the API after the dependency recovers.

**Emails not sending**:
1. Operator console → Recent failures (SMTP/SES error text).
2. Queue health: is the `send` queue processing? Is any instance running with `SEND_SCHEDULER=off` only?
3. Workspace hit its plan cap? (Settings → Plan & usage.) Capped sends wait for the reset.
4. Sender unverified or past its daily limit? (dashboard alerts.)

**Duplicate emails reported**: shouldn't be possible (lease); check `sent_emails` for the lead. If real, stop the scheduler (`SEND_SCHEDULER=off` on all instances), then investigate.

**Spike in bounces/complaints**: ask the workspace admin to pause the affected campaigns (operators can't pause other workspaces' campaigns yet), and review where the list came from. Once SES webhooks land, hard bounces and complaints auto-suppress.

**Leaked secret**:
- `JWT_*_SECRET`: rotate and restart. Everyone is signed out, nothing else is affected.
- `APP_ENCRYPTION_KEY`: rotating makes stored sender credentials unreadable. Rotate, then have workspaces re-enter SMTP passwords / reconnect senders.
- Database password: rotate in the provider, update `DATABASE_URL`/`MIGRATE_DATABASE_URL`, restart.

**Bad migration in production**: stop the API, restore the pre-deploy backup, redeploy the previous build, fix the migration on a branch.

## 8. Monitoring (T10.5, pending accounts)

- Uptime check on `GET /health/ready` every minute (any external pinger —
  UptimeRobot / Better Stack free tiers work; alert to email + phone).
- Built-in fallback: `.github/workflows/uptime.yml` probes every 30 min once
  the repo variable `UPTIME_URL` is set (Settings → Secrets and variables →
  Actions → Variables). A failed run emails the repo owner. Skipped (no
  minutes billed) while the variable is unset.
- Error tracking: Sentry DSN for API + web (hook point: `apps/web/src/app/error.tsx`).
- Cost alarms: AWS Budgets for SES + Bedrock.
- Weekly: Operator console failures feed, queue `failed` counts, `npm audit`.
