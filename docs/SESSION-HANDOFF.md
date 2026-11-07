# Session handoff (cloud session, 3–7 Nov 2026)

Read this first when continuing work. The source of truth for task status is
the vault's `V1 Task Breakdown.md` (E0–E10, 82 tasks); this file only records
what this session changed.

## Working agreements (from the owner)
- Work on branch **`cloud-session`**; commits are authored as **AxZyzz** and
  pushed as if by the owner (no co-author lines). `main` is untouched
  (`bc80d24`); no PR opened yet.
- Use the owner's real tracker; **never reconstruct or invent tasks/IDs**.
- "Don't overwrite": check what exists before changing behaviour.
- End answers with a short self-critique.

## What's on `cloud-session` (oldest → newest)
| Commit | What |
|---|---|
| `239aba0` | **T3.3 Gmail sending** via Google OAuth: Connect Gmail (Settings + onboarding), Gmail API provider, encrypted refresh token, revoked → "reconnect" |
| `7a53eb4` | Fixed all 18 React `set-state-in-effect` lint warnings (+ stale-response guards, retry-button bug) |
| `62b903b` | API `lint` is check-only; `lint:fix` added |
| `a84a48a` | Offline DNS-check unit tests; live DNS test runs only in CI / `LIVE_DNS=1` |
| `de5a0a9` | Wireframe react-router 6 → 7 (2 advisories cleared) |
| `944a5d8` | README / API README / RUNBOOK refreshed |
| `62fdf7b` | Operator console **Pause sending** for a workspace (not in the plan; was a runbook gap) |
| `960213b` | Fix: adding a campaign sequence step crashed (`reset` on null form) |
| `793a60b` | Manual segments: **Add leads** picker, remove per row, Leads bulk **Add to segment** |
| `2d69f36` | **T1.3 Password reset** + system mailer (`SYSTEM_SMTP_*`) |
| `16a4f6c` | **T7.5 Email notifications + Monday weekly summary**; Settings email column; jobs scheduler |
| `a6cf4a3` | **T2.8 Google Sheets sync** + **T9.2 Settings → Integrations** |
| `9178684` | **Security review**: 7 fixes, report in `docs/SECURITY-REVIEW.md`, live checks in `scripts/security/pentest.js` |

Checks at last commit: lint clean, 272 tests pass (1 skipped: live DNS), build
and browser E2E pass.

## New migrations (run `npm run db:migrate -w apps/api` after pulling)
- `0042_password_resets`, `0043_notification_email`, `0044_google_sheets`

## New / changed configuration (`.env`, documented in `.env.example`)
- `SYSTEM_SMTP_HOST/PORT/SECURE/USER/PASS`, `SYSTEM_EMAIL_FROM`: platform
  email (resets, notifications). Unset = not sent; outside production the
  email (incl. reset link) is printed in the API log.
- `JOBS_SCHEDULER=off` disables notification emails / weekly summary / Sheets
  sync on an instance (never removes other instances' schedules).
- `SMTP_ALLOW_PRIVATE_HOSTS=on` allows private/localhost SMTP hosts (needed
  for a local test inbox like Mailpit).
- Google OAuth (`GOOGLE_CLIENT_ID/SECRET`, redirect
  `http://localhost:4000/auth/google/callback`) serves both Gmail and Sheets.

## Verified by the owner
- Gmail sending works end to end. A campaign email landed in **spam**: the
  tracking/unsubscribe links point at `http://localhost:4000` (`API_URL`).
  Parked: options are a public HTTPS `API_URL` (e.g. cloudflared tunnel), a
  per-campaign tracking toggle, a localhost warning.

## Built but still needs a real-account check by the owner
- T1.3 / T7.5: set `SYSTEM_SMTP_*`, then reset a password / trigger a
  notification.
- T2.8: connect Sheets, import a real sheet, edit it, **Sync now**.
- Security #4 (browser-bound Google connect): one real Connect Gmail in the
  same browser.

## Still pending (from the plan)
- **AWS-blocked:** T0.3/T0.4/T0.6, T3.2 SES sender, T5.5/T5.6 bounces &
  complaints, T5.7 reply capture (MX), T6.1/T6.4 real Claude, T2.5 S3,
  T10.3 deliverability, T10.1 final sign-off (real reply).
- **Other account:** T1.7/T10.5 Sentry.
- **Owner decisions:** D-A name/domain, D-B beta audience, D-C hosting
  (→ T10.4 deploy), D-D beta size (→ T10.7 launch), T10.6 legal/DPA.
- **Deferred:** T8.1 daily rollups; Outlook sender.

## Found in code, not in the plan (owner's call)
1. With no senders ticked, a campaign sends from *any* sender, even unverified.
2. Smart segments accept an invalid tag id; the refresh then fails silently.
3. No browser tests yet for: adding a campaign step, adding leads to a
   segment, the Sheets import screens.
4. Security recommendations (see `docs/SECURITY-REVIEW.md`): 2FA for
   admins/managers, per-account login throttling, email verification at
   signup (also closes the one open finding: signup reveals existing emails),
   private infra, least-privilege IAM, audit log, key rotation, Dependabot,
   strict CSP. Last advisory: `js-yaml` via `@nestjs/swagger` (needs NestJS 12).
5. Optional: `docs/LOCAL-SETUP.md` (local-run guide).

## Testing tips for a fresh session
- No Docker needed in the cloud container: Postgres 16 and Redis are
  installed; start them, create DB `supersaas` (user/pass `supersaas`), run
  migrations. CI-like env: see `.github/workflows/ci.yml`.
- Playwright 1.64.1 expects browser build 1248; the container ships 1243, so
  alias the folder names or point `PLAYWRIGHT_BROWSERS_PATH` at an alias dir.
- The live DNS test fails offline by design; Google endpoints are stubbed in
  tests (`fetchFn` on the OAuth/Sheets services).
