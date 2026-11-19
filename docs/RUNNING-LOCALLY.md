# Running SuperSaaS locally (Windows walkthrough)

Step-by-step guide to running the whole app on your own machine: which folder,
which terminal, which command, in what order. Written for Windows 11 +
PowerShell; macOS/Linux commands are the same except where noted.

> **Short version** (everything already installed, after a reboot):
> 1. Start **Docker Desktop**, wait until it says "Engine running".
> 2. Terminal 1 (repo root): `docker start supersaas-postgres supersaas-redis`
> 3. Terminal 1: `npm run dev:api` → wait for `Nest application successfully started`
> 4. Terminal 2 (repo root): `npm run dev:web`
> 5. Open http://localhost:3000

---

## 0. The folders

| What | Path |
|---|---|
| **Repo root** (run almost every command here) | `D:\Aman\startupandworks\A2B 2.0\Company\A2B AI Technologies\Products\SuperSaaS\supersaas` |
| Backend (NestJS API + workers) | `apps\api` |
| Frontend (Next.js) | `apps\web` |
| Browser tests (Playwright) | `apps\e2e` |
| Old clickable prototype (reference only) | `apps\wireframe` |
| Shared types | `packages\shared` |
| Secrets file (never committed) | `.env` in the repo root |
| Database migrations (SQL) | `apps\api\drizzle\` |
| Docs | `docs\` |

The path has spaces, so always wrap it in quotes:

```powershell
cd "D:\Aman\startupandworks\A2B 2.0\Company\A2B AI Technologies\Products\SuperSaaS\supersaas"
```

**Rule of thumb:** run every command from the **repo root**. The `-w apps/api` /
`-w apps/web` flag tells npm which app to run the script in; you never need to
`cd` into `apps\api` yourself. The API reads `.env` from the repo root
(`envFilePath: ['.env', '../../.env']`).

### Which branch?

| Branch | What it is | Use it when |
|---|---|---|
| `main` | Stable. Real AI via **AWS Bedrock** (`AI_DRIVER=bedrock`) | Bedrock access is set up |
| `google-stack` | Everything in `main` **plus** Gemini AI, Gmail reply reading, sender name/signature editing | Testing with real AI today (Gemini key) |

```powershell
git branch --show-current        # which one you're on
git checkout google-stack        # switch (commit or stash changes first)
git pull
```

After switching branches, run **`npm install`** and **migrations** (step 4)
again: branches can have different packages and tables.

---

## 1. Prerequisites (one time)

| Tool | Version | Check | Get it |
|---|---|---|---|
| Node.js | **22 or newer** (`engines.node >=22`) | `node -v` | nodejs.org (LTS) |
| npm | comes with Node | `npm -v` | |
| Docker Desktop | any recent | `docker version` | docker.com (uses WSL 2) |
| Git | any | `git --version` | git-scm.com |

Docker runs Postgres 16 and Redis 7 for you; you don't install them directly.

---

## 2. First-time setup

All in **one PowerShell window at the repo root**.

### 2.1 Install packages

```powershell
npm install
```

Installs all workspaces (api, web, e2e, wireframe, shared) into one root
`node_modules`. Use `npm ci` instead for an exact reinstall from
`package-lock.json`.

### 2.2 Create `.env`

```powershell
Copy-Item .env.example .env
```

Then open `.env` in an editor and fill it in. **Secrets go only in this file,
never in chat, never in git** (`.env` is in `.gitignore`).

Minimum to get the app running with no outside accounts:

| Key | Local value | Why |
|---|---|---|
| `API_PORT` | `4000` | API port |
| `WEB_URL` | `http://localhost:3000` | links in emails, CORS |
| `API_URL` | `http://localhost:4000` | tracking links, OAuth callback |
| `DATABASE_URL` | already in `.env.example` (restricted `supersaas_app` role) | app connects with RLS enforced |
| `MIGRATE_DATABASE_URL` | already in `.env.example` (owner role) | migrations only |
| `REDIS_URL` | already in `.env.example` | queues, realtime |
| `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET` | random string (command below) | login tokens |
| `APP_ENCRYPTION_KEY` | 64 hex chars (command below) | encrypts sender passwords / tokens |
| `EMAIL_DRIVER` | `mock` | sends are logged, never delivered (safe default) |
| `AI_DRIVER` | `mock` | fake AI, no network |

Generate secrets:

```powershell
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

```powershell
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

First one → each JWT secret (run it twice). Second one → `APP_ENCRYPTION_KEY`.
**Don't change `APP_ENCRYPTION_KEY` later**: connected senders would no longer
decrypt and need reconnecting.

Optional keys (turn on real features):

| Feature | Keys | Notes |
|---|---|---|
| Real AI via Gemini (`google-stack` only) | `AI_DRIVER=gemini`, `GEMINI_API_KEY` | key from aistudio.google.com. Models default to `gemini-3.5-flash-lite`. See `docs/GOOGLE-STACK.md` |
| Real AI via Bedrock (`main`) | `AI_DRIVER=bedrock`, `AWS_REGION`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` | needs Bedrock model access. See `docs/SETUP-ACCOUNTS.md` |
| Real sending | leave `EMAIL_DRIVER` **blank** | then each sender's own provider is used (Gmail / SMTP) |
| Connect Gmail + Google Sheets buttons | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | redirect URI `http://localhost:4000/auth/google/callback` must be listed in Google Cloud |
| Password-reset / notification emails | `SYSTEM_SMTP_HOST`, `SYSTEM_SMTP_PORT`, `SYSTEM_SMTP_SECURE`, `SYSTEM_SMTP_USER`, `SYSTEM_SMTP_PASS`, `SYSTEM_EMAIL_FROM` | without these, reset links are **printed in the API terminal** instead of emailed |

Restart the API after any `.env` change (`Ctrl+C`, then `npm run dev:api`).

### 2.3 Start Postgres + Redis (Docker)

Start **Docker Desktop** first and wait for "Engine running". Then:

```powershell
npm run db:up
```

(= `docker compose up -d`.) Creates two containers:

| Container | Port | Image |
|---|---|---|
| `supersaas-postgres` | 5432 | postgres:16-alpine |
| `supersaas-redis` | 6379 | redis:7-alpine |

Data survives restarts (Docker volumes `pgdata`, `redisdata`). Check:

```powershell
docker ps
```

Both should say `(healthy)`.

### 2.4 Create the database tables (migrations)

```powershell
npm run db:migrate -w apps/api
```

Runs every SQL file in `apps\api\drizzle\` (0000 → latest) as the owner role.
Safe to run any time; already-applied migrations are skipped. **Run it again
after every `git pull` / branch switch.**

### 2.5 Demo login (optional)

```powershell
npm run db:seed -w apps/api
```

Creates a demo user and "Demo Workspace". The demo email and password are at
the top of `apps\api\src\db\seed.ts`. Or just sign up with your own email at
http://localhost:3000/signup.

### 2.6 Make yourself an operator (optional)

The `/operator` console (all workspaces, queue health, waitlist) is CLI-granted only:

```powershell
npm run operator -w apps/api -- grant you@example.com
```

`-- list` shows operators, `-- revoke <email>` removes one.

---

## 3. Running it (every day)

You need **two terminals**, both at the repo root. In VS Code: Terminal → New
Terminal, then the split button.

### Terminal 1: API (backend)

```powershell
npm run dev:api
```

(= `npm run start:dev -w apps/api` = `nest start --watch`.) Ready when you see
`Nest application successfully started`. Restarts itself when you save a file.

This one process runs **everything backend**: the REST API, the realtime
websocket (`/realtime`), and all background workers (CSV import, send
scheduler every 30 s, notification emails every minute, Sheets check every
15 min (each sheet re-syncs hourly), Gmail reply sync every 2 min, weekly
summary Mondays 08:00 UTC).

| URL | What |
|---|---|
| http://localhost:4000/ | health: `{"status":"ok"}` |
| http://localhost:4000/health/ready | readiness (DB + Redis) |
| http://localhost:4000/docs | Swagger API explorer (dev only) |

### Terminal 2: Web (frontend)

```powershell
npm run dev:web
```

(= `next dev --turbopack` in `apps\web`.) Open **http://localhost:3000**.

The web app talks to `http://localhost:4000` by default (override with
`NEXT_PUBLIC_API_URL`).

### Stopping

- `Ctrl+C` in each terminal.
- Containers keep running in the background; stop them with
  `npm run db:down` (data is kept) or just quit Docker Desktop.

### After a reboot

1. Start Docker Desktop → wait for "Engine running".
2. `docker start supersaas-postgres supersaas-redis`
3. Terminal 1: `npm run dev:api`
4. Terminal 2: `npm run dev:web`

Order matters: **Docker → API → web**. If the API isn't up, the login page
shows "Something went wrong".

---

## 4. Ports at a glance

| Port | Service | Started by |
|---|---|---|
| 3000 | Web (Next.js) | `npm run dev:web` |
| 4000 | API (NestJS) + websocket + workers | `npm run dev:api` |
| 5432 | Postgres | Docker |
| 6379 | Redis | Docker |
| 5173 | Wireframe prototype (optional) | `npm run dev:wireframe` |

---

## 5. Tests

All from the repo root, with Docker running.

| What | Command | Notes |
|---|---|---|
| API unit + integration (~293 tests) | `npm test -w apps/api` | uses the real local Postgres/Redis; forces mock email + mock AI; each run uses its own queue prefix so a running dev API doesn't interfere |
| One API test file | `npm test -w apps/api -- gmail-reply-sync` | any part of the filename |
| Browser end-to-end | `npm run e2e -w apps/e2e` | reuses your running API/web if up, otherwise starts them. First time: `npx playwright install chromium` |
| E2E with a visual runner | `npm run e2e:ui -w apps/e2e` | |
| Lint (check only) | `npm run lint` | fix: `npm run lint:fix -w apps/api` |
| Build everything | `npm run build` | what CI does |
| AI quality eval | `npm run eval -w apps/api` | mock = pipeline check; with `AI_DRIVER=gemini` or `bedrock` in `.env` = real scores |

CI (GitHub Actions, `.github/workflows/ci.yml`) runs audit, migrations, lint,
tests, build and E2E on pushes and pull requests to `main` (not on
`google-stack` pushes, so run the tests locally there).

---

## 6. Testing real features in the UI

| Feature | How |
|---|---|
| Send a real email | Settings → Senders → **Connect Gmail** (needs Google keys) or **Add SMTP**. Set `EMAIL_DRIVER` blank. Only verified senders can send |
| See replies (google-stack) | Gmail sender must show **Replies: synced…** in Settings (reconnect and tick "Read your email"). Reply from another account, then Inbox → **Sync Gmail** (or wait 2 min). Your Gmail address must be a *test user* in Google Cloud's OAuth consent screen |
| Fake a reply without Gmail | Inbox → **Test reply** |
| Opens / clicks | **Don't work on localhost**: tracking links point to `API_URL`, which the recipient's mail app can't reach. Needs a public HTTPS URL (Cloudflare tunnel below, or hosting) |
| Password reset | Without `SYSTEM_SMTP_*`, the reset link is printed in the API terminal: copy it into the browser |

### Optional: public URL for open/click tracking (Cloudflare tunnel)

```powershell
winget install --id Cloudflare.cloudflared
```

```powershell
cloudflared tunnel --url http://localhost:4000
```

It prints an `https://<random>.trycloudflare.com` URL. Put it in `.env` as
`API_URL`, restart the API, send a new campaign email. The URL changes every
time you restart the tunnel.

---

## 7. Troubleshooting

| Symptom | Cause / fix |
|---|---|
| Login says "Something went wrong" | API not running, or Docker not running. Check Terminal 1; `docker ps` |
| Docker Desktop won't start: "cannot remove … dockerInference" / "engine.sock" | Quit Docker → `wsl --shutdown` → rename `%LOCALAPPDATA%\Docker\run` and `%LOCALAPPDATA%\docker-secrets-engine` to `*.stale-1` → start Docker → `docker start supersaas-postgres supersaas-redis`. Repeat once if a second socket complains |
| API crashes with `relation … does not exist` / `column … does not exist` | Migrations not applied: `npm run db:migrate -w apps/api` |
| `EADDRINUSE :4000` or `:3000` | Already running in another terminal. Close it, or find the process: `Get-NetTCPConnection -LocalPort 4000` |
| `ECONNREFUSED 127.0.0.1:5432` / `:6379` | Containers stopped: `docker start supersaas-postgres supersaas-redis` |
| "Generation failed" / "AI is busy" | Gemini overloaded or key wrong. Retry; check `GEMINI_API_KEY`; check the API terminal for the exact error |
| Gmail sender shows "reconnect" | Token revoked/expired (testing-mode Google apps expire tokens after 7 days). Click reconnect |
| System emails fail with `535` | SMTP login rejected. Gmail needs 2-step verification **and** an app password (16 letters, no spaces) |
| Tests fail mysteriously | Docker running? Migrations applied? Re-run just the failing file |
| Weird errors after `git pull` | `npm install` + `npm run db:migrate -w apps/api`, then restart both apps |

---

## 8. Related docs

- `docs/RUNBOOK.md`: production operations, deploy order, backups
- `docs/SETUP-ACCOUNTS.md`: AWS / Google accounts
- `docs/GOOGLE-STACK.md`: Gemini + Gmail reply reading (google-stack branch)
- `docs/BUILD-SUMMARY.md`: everything built so far
- `docs/architecture/`: architecture diagram (Excalidraw) and its explanation
- `docs/DEV-LOG.md`: session-by-session log
