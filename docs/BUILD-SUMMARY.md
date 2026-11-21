<!-- Copy of the vault note 'Products/SuperSaaS/Build Summary.md' (the vault is the
     source of truth; this copy keeps the record next to the code). Refreshed with
     every logged session. -->


# SuperSaaS — Build Summary

> One document that answers "what have we built, and what is still open?". It is a **synthesis**: the
> task-by-task checklist stays in V1 Task Breakdown,
> the feature spec in Spec Index, and the
> day-by-day record in _log. This note ties them together with commit-level detail.
> Facts below come from the git history of both branches, the plan file, `docs/SECURITY-REVIEW.md` and the
> work sessions of 2026-11-03 → 2026-11-09. Where a number or behaviour could not be re-checked it says so.

---

## 1. State in one screen (2026-11-09)

| Item | Value |
|---|---|
| Product | SuperSaaS (working title): AI cold-email outreach platform, A2B's own product, no clients |
| Builders | Aman + Claude Code (solo build) |
| Repo | `Products/SuperSaaS/supersaas/` → private GitHub `AxZyzz/supersaaswireframe` |
| Branches | `main` at `8afb3e3` (79 commits) · `cloud-session` kept at the same commit |
| Merge state | **Merged 2026-11-12:** `main` fast-forwarded `bc80d24` → `8afb3e3` and pushed |
| Tests | **276 passed, 1 skipped** (live DNS, by design), 49 suites |
| Browser E2E | 1 Playwright happy-path test (sign-up → import → AI campaign → send → reply → inbox → dashboard → Excel import → logout), passes on both |
| Database | PostgreSQL 16, **45 migrations** (`0000`–`0044`), row-level security on every tenant table |
| Lint / build | API and web lint clean · web production build passes (Next.js 16.4.2) |
| Plan status | All 10 acceptance criteria met **in code**. What is left needs outside accounts (AWS, Sentry, Google verification) or your decisions (name, beta audience, hosting, legal) |
| AI | Runs on a **mock** by default. Real Claude via AWS Bedrock is built but has **never been run** (no AWS account yet) |
| Real-world check done | **Gmail sending verified end to end by Aman** (campaign mail arrived, but in spam, see §9) |

---

## 2. Ground rules and working agreements

**Standing rules from Aman (still in force):**
1. Claude never logs into AWS / Google / Anthropic consoles, never creates accounts, never types credentials. Account setup is guidance only (`docs/SETUP-ACCOUNTS.md`).
2. Secrets live in a gitignored `.env` and never in chat. `.env` is never committed.
3. **Push to GitHub after every update.**
4. State the plan and get a go before big moves (restructure, rename, merge, delete).
5. Test credentials are used only on localhost.
6. Auto-capture: durable facts from every message are filed into the vault without being asked.

**Workflow per chunk:** build → test → verify in the browser when it is visible → commit → push → update the vault (`V1 Task Breakdown.md`, `_log.md`).

**Reported in the cloud-session handoff (written by the cloud agent, not confirmed by Aman directly):** work on branch `cloud-session`, commits authored as `AxZyzz` with no co-author line, never reconstruct tasks, check what exists before changing behaviour, end answers with a short self-critique. The last two commits on `cloud-session` (`7ee8a81`, `8afb3e3`) do carry a Claude co-author line. **Open question for Aman: keep or drop that line?**

**Git identity:** `AxZyzz` (the account on every commit), pushed through Git Credential Manager.

---

## 3. Architecture in plain terms

**Monorepo (npm workspaces, Node 22):** `apps/api` (NestJS 11.1.28, pinned) · `apps/web` (Next.js 16.4.2, React 19.2.9, Tailwind v4) · `apps/e2e` (Playwright 1.64.1) · `apps/wireframe` (Phase 0 prototype, react-router 7.18.5) · `packages/shared`.

**API modules:** `ai`, `analytics`, `auth`, `beta`, `campaigns`, `config`, `crypto`, `db`, `google`, `inbox`, `integrations`, `jobs`, `leads`, `mail`, `notifications`, `operator`, `orgs`, `queue`, `realtime`, `senders`, `sending`, `templates`, `usage`.

**Web routes:** dashboard, leads (+ profile), segments (+ detail), campaigns, templates, inbox, analytics, settings, help, operator (staff only), onboarding, login, signup, forgot-password, reset-password, invite/[token], and public pages `/`, `/pricing`, `/privacy`, `/terms`.

**Multi-tenancy (the most important design decision):**
- Every tenant table has `org_id` and `ENABLE` + `FORCE ROW LEVEL SECURITY` with a fail-closed `NULLIF` policy.
- The app connects as a restricted role `supersaas_app` (no superuser, no bypass). The superuser URL is for migrations only.
- All tenant queries run through `withOrgContext(pool, orgId, fn)`, which opens a transaction and sets the org with `SET LOCAL`.
- The only cross-tenant reads are `SECURITY DEFINER` functions with scoped `EXECUTE`: `user_memberships`, `due_campaign_sends`, `resolve_tracking`, `resolve_unsub`, `verify_api_key`, `pending_notification_emails`, `operator_*`.
- An automated isolation test suite proves tenant A cannot see tenant B.

**Sessions and auth:**
- Access JWT lives 15 minutes and is held **only in page memory**.
- Refresh token lives 30 days in an **httpOnly, Secure (in production), SameSite=Lax cookie scoped to `/auth`**. Rotated on every use, with theft detection (replay of an old token revokes the whole family) and a 30-second grace window for two-tab races.
- `/auth/refresh` and `/auth/logout` require an `X-Requested-With` header (CSRF guard). A refresh keeps the workspace the user had switched to.
- Every request checks the **live** membership (30-second cache, invalidated on change), so a removed member loses access immediately.
- Roles: Admin / Manager / Agent. Last-admin protection on demote/remove.
- Operators (A2B staff) are granted by CLI only: `npm run operator -w apps/api -- grant <email>`.

**Sending:** `EmailProvider` interface (`send`, `verify`) with SMTP (real), Gmail OAuth (real), SES (stub until AWS) and Mock (`EMAIL_DRIVER=mock`). A BullMQ repeatable job runs the send tick; `POST /sending/tick` runs it manually. A claim lease (`next_send_at = now()+10min` on claim) stops overlapping ticks double-sending.

**AI:** `AIProvider` interface with one method `generate()`. Tiers `fast` / `balanced` / `powerful` map to model names through `AI_MODEL_FAST|BALANCED|POWERFUL`. Providers: Mock (default) and Bedrock (Claude Haiku 4.5 / Sonnet 5 / Opus 5). `AI_DRIVER` picks one. Prompts are versioned: `classify-reply@1`, `sequence@1`, `reply-draft@1`, `refine-email@1`.

**Realtime:** Socket.io gateway at `/realtime`, Redis adapter, token + live-membership auth, org and user rooms. Events say only *what changed* (`inbox`, `notifications`, `campaigns`, `team`); clients refetch over REST.

**Rate limiting:** shared Redis store (atomic Lua script, fails open with a 500 ms timeout). Default 100/min per IP; sign-up and login 10/min; refresh 20/min; waitlist 5/min; inbox reply 30/min; AI reply-draft 20/min; AI refine 30/min; public API per key (default 120/min, range 1–6000, with a 6000/min per-IP ceiling).

---

## 4. Full chronological record (every commit)

### Phase 0 → E1: foundation (June–July 2026)
| Date | Commit | What |
|---|---|---|
| 06-19 | `5f90adc` | Initial commit (wireframe prototype) |
| 07-18 | `760057e` | Snapshot of wireframe before monorepo conversion (Yakin Shah project taken over as A2B's own product) |
| 07-19 | `94e3c99` | **E0:** repo converted to the SuperSaaS monorepo |
| 07-19 | `f006e24` | **E1:** DB layer with RLS multi-tenancy (Drizzle + Postgres), restricted app role, isolation tests |
| 07-19 | `071192d` | **E1:** auth + workspace layer (JWT, refresh rotation + reuse detection, role guards) |
| 07-19 | `dcb7c36` | **E1:** web app shell, Swagger docs, CORS, dev seed |
| 07-21 | `8442cf7` | Fixes from the 4-agent E0/E1 audit (login timing leak, `lower(email)` index, missing container token, `.env.example`, Prettier config) |

### E2 – E3: leads and senders (July)
| Date | Commit | What |
|---|---|---|
| 07-22 | `4e2e557` | **E2.1** leads schema, CRUD API, table + profile UI |
| 07-22 | `28e2703` | **E2.2** CSV import with BullMQ worker, column-mapping UI |
| 07-22 | `f359b7e` | **E2.3** kanban view, CSV export |
| 07-22 | `b348674` | **E2.4** duplicate detection + merge |
| 07-23 | `fa07c22` | **E2.5a** segments backend: manual + smart rule engine, refresh worker |
| 07-23 | `d175367` | **E2.5b** segments UI |
| 07-23 | `cce6f9e` | **E2.6a** public REST API + API keys |
| 07-23 | `3c00d34` | **E2.6b** API keys settings UI |
| 07-23 | `7d4866e` | **E3.1a** sender accounts + live SPF/DMARC DNS checker |
| 07-23 | `2f8935c` | **E3.1b** sender + DNS settings UI |
| 07-24 | `b4441a5` | Click-by-click account setup guide (AWS / Google / Anthropic) |
| 07-29 | `eaacbe0` | **E3.2** SMTP sender, `EmailProvider` abstraction, AES-256-GCM crypto service |
| 07-29 | `85618fa` | **E2** completed: default tag seeding, bulk tag ops, tag delete |

### E4 – E6: templates, campaigns, sending, AI (July–August)
| Date | Commit | What |
|---|---|---|
| 07-30 | `5841a8b` | **E4.1** template library, editor, personalization, test-send, 5 starter templates |
| 07-30 | `43afd87` | **E4.2** campaign model, sequence steps, per-lead state machine, enrollment |
| 07-31 | `99d40b5` | **E5.1** send engine: scheduler, render pipeline, events, suppression |
| 07-31 | `dbcf4d1` | **E5.2** open/click tracking, unsubscribe endpoints, campaign stats |
| 08-01 | `4e8e36a` | **E4.3** guided 4-step campaign wizard, duplicate / pause / resume / schedule |
| 08-02 | `c988b19` | **E6.1** AI layer foundation (provider seam, service, prompts) |
| 08-02 | `fc84794` | **E6.2** Knowledge Base + AI campaign builder (mock-testable) |

### E7 – E9 and hardening (1–3 November)
| Date | Commit | What |
|---|---|---|
| 11-01 | `05738fd` | **E8.1** analytics API, real dashboard, analytics page |
| 11-01 | `9b68a11` | **E7.1** unified inbox, reply ingestion, sequence automations, AI classification |
| 11-01 | `3459792` | **E7.2** notes, assignment, conversion, in-app notifications |
| 11-02 | `54f222e` | Production hardening: env validation, helmet, readiness check, dependency fixes |
| 11-02 | `4d62a53` | **E9.1** workspace profile, branding, onboarding wizard |
| 11-02 | `1638401` | **E9.2** team invites, roles, removal, live-membership authz |
| 11-02 | `4fefcc8` | **E9.3** public landing + pricing |
| 11-02 | `72a0404` | Setup guide updated (Bedrock instead of Anthropic key, reply ingestion, launch prerequisites) |
| 11-02 | `97aebef` | **E9.4** help center, ⌘K palette, error handling, role-aware settings |
| 11-02 | `9e7d025` | Plan-limit enforcement + usage meter; **fixed refresh-race logouts** |
| 11-02 | `1c9a171` | Playwright happy-path E2E + the 3 bugs it caught |
| 11-02 | `9ae0b08` | Authorization matrix test + tighter agent permissions (T10.2) |
| 11-02 | `bd130a8` | Compliance pass: CAN-SPAM footer, GDPR export/erasure, legal pages (T10.6, code side) |
| 11-03 | `39ecf7c` | Operator console for A2B staff (T8.6); no logout on network errors |
| 11-03 | `5182fb9` | Live updates over Socket.io (T7.2); multer kept patched |
| 11-03 | `a23bec9` | Analytics date ranges, per-step stats, CSV/PDF reports (T8.4) |
| 11-03 | `7201933` | Notification preferences (rest of T9.2) |
| 11-03 | `7010154` | AI prompt versioning + eval set (T6.7) |
| 11-03 | `9a613cd` | Runbook (T10.8) + **fixed double-sends** from overlapping send ticks |

### "Everything pending" pass, part 1 (3 November)
| Commit | What |
|---|---|
| `3c8d2a7` | Sender **warm-up ramp** (T5.2) |
| `7ca8ef7` | **Beta tooling:** waitlist, invite-only sign-up, in-app feedback (T10.7) |
| `e7e9fb9` | **Reply to a lead from the inbox**, threaded (T7.3) |
| `e62c974` | Inbox filters by campaign and date (T7.4) |
| `d2a3fe2` | Segment rules: opened / never opened / replied (T2.7) |
| `b8f0ec3` | Template and lead-source analytics (T8.3) |
| `1b40882` | Redis-backed rate limiting shared across servers (T1.3) |
| `43a513b` | **httpOnly cookie sessions**, tokens out of localStorage |
| `733362c` | Bot and prefetch open/click filtering (T5.4) |
| `18b7d22` | Per-key rate limits for the public API (T2.9) |
| `758c57a` | AI reply drafts + chat-style draft editing (T6.6, T6.3) |
| `35c6c29` | Workspace lead-status manager (T2.3) |
| `ac974c4` | Excel (.xlsx) import (T2.5) |
| `9cc5241` | Scheduled uptime probe (T10.5) |
| `1c3fcf0` | Upgrade to Next.js 16.4.2 + React 19.2.9 |
| `b33c952` | Visual (WYSIWYG) email editor + sanitized in-app previews (T4.2) |
| `bc80d24` | Dark mode (system / light / dark) ← **`main` ends here** |

### Cloud session (3–7 November), on `cloud-session` only
| Date | Commit | What |
|---|---|---|
| 11-03 | `239aba0` | **Gmail sending via Google OAuth** (T3.3) |
| 11-03 | `7a53eb4` | Cleared all 18 React "set-state-in-effect" lint warnings (+ stale-response guards, a retry-button bug) |
| 11-03 | `62b903b` | API `lint` is check-only; `lint:fix` added |
| 11-03 | `a84a48a` | Offline DNS-check unit tests; the live lookup runs only in CI or with `LIVE_DNS=1` |
| 11-03 | `de5a0a9` | Wireframe react-router 6 → 7.18.5 (2 advisories cleared) |
| 11-03 | `944a5d8` | README, API README and runbook refreshed |
| 11-03 | `62fdf7b` | Operator **Pause sending** for a workspace (not in the plan; fills a runbook gap) |
| 11-03 | `960213b` | Fixed: adding a campaign sequence step crashed |
| 11-03 | `793a60b` | Manual segments: "Add leads" picker, remove per row, bulk "Add to segment" on Leads |
| 11-03 | `2d69f36` | **Password reset by email** (T1.3) + system mailer (`SYSTEM_SMTP_*`) |
| 11-03 | `16a4f6c` | **Email notifications + Monday weekly summary** (T7.5) |
| 11-03 | `a6cf4a3` | **Google Sheets sync** (T2.8) + Settings → Integrations (T9.2) |
| 11-04 | `9178684` | **Security review:** 7 findings fixed (§7) |
| 11-07 | `2c7bb59` | Session handoff document |
| 11-07 | `7ee8a81` | Tests isolated from a developer's local `.env` and from shared dev-DB data |
| 11-08 | `8afb3e3` | **Campaigns send only from verified senders** (Aman's decision) |

---

## 5. What exists now, by area (minute detail)

### 5.1 Accounts, workspaces, auth
- Sign-up creates user + workspace + admin membership, seeds 5 starter tags (Hot Lead, Follow Up, Customer, Partner, Cold) and 5 starter templates (cold intro, 2 follow-ups, meeting request, value/case-study).
- Login, logout (revokes the refresh token server-side and clears the cookie), switch-organisation, `/auth/me` (includes `isOperator`).
- **Password reset:** request by email (same answer for unknown emails), single-use hashed token that expires, setting a new password revokes all sessions. Passwords over 72 bytes are refused (bcrypt would silently truncate). Cost 12; a real dummy hash is compared for unknown emails so response time does not reveal who has an account.
- **Invites by link** (single-use, bound to the invited email) for existing and new users; role changes and removal; last-admin protection.
- **Beta sign-up control:** `SIGNUP_MODE=waitlist` makes sign-up invite-only. Public waitlist form (rate-limited, same answer always). Operator approves an entry in `/operator` and gets a single-use invite link. In-app **Feedback** button lands in the operator console.
- **Account deletion / data rights:** delete workspace, delete account (password re-check; refused for the sole admin of a workspace with other members), forget a lead (erasure + suppression), JSON export of a workspace.
- **Operator console** (`/operator`, A2B staff only): workspaces, plans (beta / internal), recent failures, queue health, system health, uptime, waitlist approvals, feedback, **Pause sending** for a workspace (requires a reason, notifies every member, leaves drafts alone).

### 5.2 Leads
- List with search (case-insensitive), filters (status, score, source, tag), whitelisted sort, pagination, **kanban** with drag-and-drop status change, CSV export (formulas neutralised), profile page (details, activity timeline, notes, inline edits).
- **Import:** CSV and **Excel (.xlsx)** (first sheet converted to CSV in the browser, 10 MB cap, dates as ISO text) through a BullMQ worker; column mapping UI with auto-guess; skip or update duplicates (case-insensitive email); per-row error report. **Google Sheets** sync (see §5.10).
- **Duplicates:** detection (normalised name + company) and merge (consolidates tags, notes, events and fields).
- **Tags:** create, attach/detach, filter, bulk attach/detach, delete.
- **Statuses:** free text on the lead. The workspace status manager (Settings → Lead statuses) adds custom statuses with colours, reorders, renames (leads migrate) and deletes with a replacement. Six **system statuses** (`new`, `contacted`, `replied`, `interested`, `converted`, `lost`) are locked because reply automation writes them.
- **Segments:** manual (add/remove leads) and smart (rule builder, all/any match, materialised membership refreshed by a BullMQ worker). Rule fields: status, score, source, company, email present/absent, tag has / does not have, created within N days, and **engagement** (emailed, never emailed, opened, emailed-never-opened, clicked, replied, emailed-no-reply).
- **Public REST API:** `POST /v1/leads` with `X-Api-Key` (create or upsert). Keys are SHA-256 hashed with a visible prefix, shown once, revocable, with a **per-key requests-per-minute limit** (429 + `Retry-After`, `X-RateLimit-*` headers).

### 5.3 Senders and deliverability
- Multiple senders per workspace: Gmail, SMTP, SES (stub). From name/email, reply-to, signature, daily limit, send window.
- **Gmail OAuth:** scopes `gmail.send` + `openid email` only. Refresh token AES-256-GCM encrypted. A revoked/expired grant flips the sender to unverified and asks to reconnect.
- **SMTP:** password AES-256-GCM encrypted; **Verify connection** and **Send test**. SSRF guard: mail ports only (25/465/587/2525), private/loopback/link-local/CGNAT/metadata addresses refused on save and again after DNS at every connection (`SMTP_ALLOW_PRIVATE_HOSTS=on` for an internal server).
- **Live DNS checker** for SPF and DMARC with DKIM guidance.
- **Warm-up ramp:** 20/day for days 1–7, 50 for 8–14, 100 for 15–30, then the full limit; skip or restart per sender; over-cap sends are deferred, not failed.
- **Verified-only sending (Aman's decision, 2026-11-08):** the engine only picks senders whose status is `verified`. None usable → the lead waits. A Gmail grant that breaks mid-send records the attempt as failed, flags the sender, and retries the same step in 15 minutes instead of skipping it. New senders are verified automatically right after they are added.

### 5.4 Templates
- Library with folders, duplicate, preview (sample or real lead), test-send, `{variable|fallback}` personalization.
- **Visual editor** (bold, italic, underline, links, lists, clear formatting; variable chips insert at the caret; pastes arrive as plain text) plus raw HTML mode. Bodies the visual surface cannot round-trip stay in HTML mode with a note.
- **Security:** previews go through an allow-list sanitizer (a crafted template could previously run script in a teammate's session). Merge values are HTML-escaped in every HTML body.
- Email "paper" stays white in dark mode.

### 5.5 Campaigns
- Multi-step sequences: per-step template, delay, **condition** (always / opened-no-reply / not-opened), **A/B subject variants** assigned round-robin with results per variant.
- Guided 4-step wizard (Setup → Sequence → Senders → Review) → launch now or schedule. Pause, resume, duplicate, archive. Status lifecycle: draft, scheduled, active, paused, completed, archived.
- Per-lead state machine (`campaign_leads`): current step, status, stop reason, next send time.
- **Stop-on-reply**; out-of-office → next step moves +3 days; not-interested → stops and tags the lead.

### 5.6 Sending engine and tracking
- Scheduler tick: finds due sends across all tenants (definer function), then works per tenant. Respects send window, daily limit, warm-up ramp, plan email caps (deferred, not dropped), suppression list, and verified-only senders. Network call is held outside the DB transaction.
- Render pipeline: variable substitution, tracked links, open pixel, unsubscribe footer with postal address (CAN-SPAM), `List-Unsubscribe` + RFC 8058 one-click header.
- **Tracking:** `/t/o/:id` (open pixel), `/t/c/:id?u=` (click redirect). Click links are **HMAC-signed**, so the redirect cannot be abused as an open redirect. **Bot filter:** hits with no user agent, a known scanner agent, or within 10 seconds of sending are stored as `bot_open` / `bot_click` and excluded from stats and gates. Gmail's image proxy counts as human; Apple Mail prefetch cannot be told apart and still counts.
- **Unsubscribe:** GET shows a confirm page with no side effects (link scanners cannot unsubscribe anyone), POST suppresses the address workspace-wide and stops the enrolment.
- Events: sent, open, click, unsubscribe, reply, failed; mirrored on the lead timeline (first touch only).

### 5.7 AI
- **Knowledge Base:** description, audience, offer, pain points, USPs, competitors, testimonials, injected into every generative prompt.
- **AI campaign builder:** brief → generated sequence → edit → approve into a draft campaign. **"Ask AI to edit"** per step with quick chips and multi-step undo (preserves `{tokens}`).
- **Reply classification** (interested, not interested, question, out of office, wrong person, manual review) with confidence; failures go to manual review.
- **AI reply drafts** in the inbox composer ("Draft with AI" / "Rewrite with AI"; typed notes steer it). The thread is fenced as untrusted data and the prompt forbids following instructions inside it. **Never auto-sent.**
- Per-organisation token logging (`ai_usage` with prompt version); monthly AI quota (30 generations on the beta plan).
- **Eval harness:** 25 labelled replies + 5 briefs, `npm run eval -w apps/api` (real scores only once a real model is connected).
- Mock outputs are realistic so every flow demos without credentials.

### 5.8 Inbox and notifications
- Three-pane inbox: list, thread (sent campaign emails and replies merged, internal notes), lead context panel. Search, filters (classification, unread, open/closed, **campaign**, **last-activity range**).
- Actions: read/unread, close/reopen, reclassify, assign (notifies the assignee), internal notes, convert (lead → converted, sequence stopped), **reply to the lead** (sent from the conversation's sender, `Re:` subject, `In-Reply-To`/`References` threading, logged on the thread and lead timeline).
- Live updates over Socket.io; unread badge.
- **Notifications:** in-app bell with deep links and mark-read; per-type preferences; **email delivery** and a **Monday weekly summary** (quiet weeks send nothing) via the system mailer.

### 5.9 Analytics
- Dashboard: lead/campaign/send counts with 7-day deltas, engagement, activity feed, sender alerts, "Start here" checklist.
- Analytics page: date ranges (7/30/90/all/custom), funnel, campaign table with per-step and per-variant detail, **template performance**, **lead-source funnel**, campaign CSV (formula-safe) and Save-as-PDF.

### 5.10 Integrations (cloud session)
- **Google Sheets → leads:** connect (read-only scope `spreadsheets.readonly`), preview a sheet (title, tabs, headers, first rows), map columns, import as `google_sheet` leads, re-sync picks up edits, manual **Sync now**, hourly scheduled sync, clear error when a sheet is no longer shared, disconnect pauses syncs, deleting a sync keeps its leads.
- Settings → **Integrations** page for Gmail and Sheets connections.
- Both Google connects are **browser-bound** (see §7, finding 4).

### 5.11 Settings, onboarding, public site, help
- Settings: workspace profile + **branding** (logo, brand colour applied app-wide at runtime), team, senders, API keys, knowledge base, lead statuses, notification preferences (including email), integrations, usage/plan meter, privacy.
- Onboarding wizard: workspace → business knowledge → connect sender → DNS check → done (every step skippable).
- Help center (13 articles with search), contextual `?` links, ⌘K / Ctrl+K command palette, error boundary and 404, retryable error states.
- Public landing and pricing (beta = free; draft $29–$199 tiers shown as indicative behind `SHOW_PLANNED_TIERS`), draft privacy and terms pages.
- **Dark mode:** system / light / dark toggle in the header; applied before first paint (no flash); org brand tints mix against the surface so custom colours work in both themes.

### 5.12 Plan limits
Beta plan limits are enforced (`usage/plan-limits.ts`): leads, active campaigns, steps, senders, seats, emails per day and month, AI generations. The `internal` plan is unlimited. Hitting a cap returns `403 LIMIT_REACHED`. Exact numbers follow Rate Limits.

---

## 6. Bugs found and fixed (all verified)

| # | Bug | Found by | Fix |
|---|---|---|---|
| 1 | Login timing leaked which emails exist (malformed dummy hash short-circuited) | E0/E1 audit | Real cost-12 dummy hash |
| 2 | Email unique index was on raw email, not `lower(email)` | Audit | Migration 0004 |
| 3 | `max-w-shell` silently ungenerated | Audit | Added `--container-shell` token |
| 4 | Users logged out about every 15 minutes (parallel 401s spent one rotating refresh token → looked like theft) | Live use | Client single-flights refresh; server 30 s reuse grace |
| 5 | Empty AI drafts on the mock provider | E2E | Mock returns a realistic sequence |
| 6 | Campaign notes never shown | E2E | Fixed |
| 7 | `start:prod` broken | E2E | Fixed |
| 8 | CSV import broke after a schema change | Live use | Fixed |
| 9 | Agents could do more than intended (templates write, CSV import) | Authz matrix | Tightened to admin/manager |
| 10 | Stale Redis repeat job made tests flaky | Test runs | Cleared in test setup |
| 11 | Any network error or 5xx logged users out | Live use | Only a 401 redirects; others show a retry screen |
| 12 | CSV exports allowed spreadsheet formula injection | Review | Formulas neutralised |
| 13 | **Overlapping send ticks double-sent** (reproduced: 15 sends for 5 leads) | Review | Claim lease |
| 14 | Warm-up ramp promised in the plan but missing | Plan check | Built |
| 15 | Template preview ran raw HTML (stored XSS between teammates) | Review | Allow-list sanitizer |
| 16 | `bg-neut-bg` colour token was never defined (badges had no background) | Dark-mode work | Defined |
| 17 | Adding a campaign sequence step crashed | Cloud session | `960213b` |
| 18 | Weekly-summary test failed on a shared dev DB (50-item mail ring pushed the message out) | Review of cloud branch | Call-through spy, 30 s limit (`7ee8a81`) |
| 19 | Any local real-sending `.env` made 35+ send tests fail | Review of cloud branch | Jest setup forces mock email + AI drivers |
| 20 | A broken Gmail sender kept being picked and burned a lead's step | Review of cloud branch | Verified-only + retry in 15 minutes (`8afb3e3`) |

---

## 7. Security work

**Pass 1 (E10 hardening):** boot-time env validation (production refuses weak or missing JWT secrets, bad encryption key, `EMAIL_DRIVER=mock`); helmet; `TRUST_PROXY`; Swagger off in production; `GET /health/ready` (DB + Redis, 503 on failure); critical CVEs cleared; CI gate on critical advisories; authz matrix test over **every route** (public allow-list enforced, 401/403 asserted per role, `docs/AUTHZ-MATRIX.md` generated); CAN-SPAM and GDPR features.

**Pass 2 (white-box review + live pentest, 2026-11-04, `docs/SECURITY-REVIEW.md`).** 6 of 50 live checks vulnerable before, 1 of 51 after.

| # | Finding | Severity | Status |
|---|---|---|---|
| 1 | Open redirect in click tracking | Medium | Fixed (HMAC-signed links; also fixed `&amp;` breaking query strings) |
| 2 | HTML injection into outgoing emails through lead fields | Medium | Fixed (escaped in every HTML body) |
| 3 | SSRF through SMTP senders | Medium | Fixed (port allow-list, private-range refusal, DNS re-check, vetted-IP connection) |
| 4 | OAuth CSRF on Connect Gmail/Sheets | Medium | Fixed (single-use httpOnly browser cookie bound into the signed state) |
| 5 | bcrypt truncates passwords after 72 bytes | Low | Fixed (refused) |
| 6 | No web security headers (clickjacking) | Low | Fixed (frame-ancestors, nosniff, Referrer-Policy, Permissions-Policy, HSTS) |
| 7 | SMTP `From` display name not encoded | Low | Fixed |
| 8 | Sign-up reveals whether an email has an account | Low | **Open:** needs email verification, a product decision |

Verified secure live: 13 cross-tenant IDOR attempts all 404, role boundaries, token tampering (`alg=none`, tampered `orgId`), session cookie flags, brute-force throttling not bypassed by a spoofed `X-Forwarded-For`, SQL injection resistance, XSS, mass assignment (`isOperator`, `plan`), secrets encrypted and never returned.

**Other:** Next.js 16.4.2 cleared the `next` and `postcss` advisories. One moderate advisory remains (`js-yaml` inside `@nestjs/swagger`, unreachable here, fixed by NestJS 12).

---

## 8. Decisions made

| Decision | Outcome |
|---|---|
| Product direction | SuperSaaS becomes A2B's own product; Yakin Shah is out (closed 2026-07-18); his client constraints are void |
| White-label | Readiness only in V1 (branding + theming tokens); custom domains = V2 |
| Warm-up | Basic ramp in V1 (built); full warm-up network later |
| Sending | Hybrid: SES primary + Gmail OAuth + SMTP; Outlook deferred |
| Brilliant Directories | Cut from V1 |
| Pricing | Beta free with V1 limits enforced; public pricing before paid launch (draft $29–$199) |
| Stripe | Not in V1; usage metering only |
| Claude access | Via AWS Bedrock, not an Anthropic API key |
| Infra for dev | Docker (Postgres 16, Redis 7) |
| ORM | Drizzle, hand-written SQL migrations plus manual journal entries |
| Sessions | httpOnly refresh cookie + in-memory access token (replaces localStorage) |
| **Verified-only sending** | **Aman, 2026-11-08:** campaigns send only from verified senders |

**Still open (yours):** D-A product name + domain · D-B target market · D-C hosting (AWS vs cheap VPS; the old plan estimated about $257/month on AWS vs about $50–80/month on a small box) · D-D beta size and channel.

---

## 9. Real-world checks

| Check | Result |
|---|---|
| Gmail sending end to end | ✅ Verified by Aman |
| Campaign email deliverability | ⚠️ Landed in **spam**: tracking and unsubscribe links point at `http://localhost:4000` (`API_URL`). Needs a public HTTPS address (a tunnel works for testing) |
| Password reset / notification emails | ⏳ Needs `SYSTEM_SMTP_*` set, then try one |
| Google Sheets (connect, import, edit, Sync now) | ⏳ Needs a real sheet |
| Browser-bound Google connect | ⏳ One real **Connect Gmail** in the same browser |
| Real Claude output | ⏳ Never run; needs AWS |

---

## 10. Configuration reference (`.env.example`)

App: `NODE_ENV`, `API_PORT`, `WEB_URL`, `API_URL`, `TRUST_PROXY`, `SIGNUP_MODE` (open / waitlist), `COOKIE_SAMESITE` (lax / strict / none), `COOKIE_DOMAIN`, `JOBS_SCHEDULER` (off disables notification emails, weekly summary and Sheets sync on an instance), `SWAGGER`.
Data: `DATABASE_URL` (restricted app role), `MIGRATE_DATABASE_URL` (superuser, migrations only), `REDIS_URL`.
Secrets: `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `JWT_ACCESS_TTL`, `APP_ENCRYPTION_KEY` (64 hex; also signs click links).
Email: `EMAIL_DRIVER` (mock forces the mock provider, never in production), `SYSTEM_SMTP_HOST|PORT|SECURE|USER|PASS`, `SYSTEM_EMAIL_FROM`, `SMTP_ALLOW_PRIVATE_HOSTS`, `INBOX_SIMULATE` (dev-only reply simulator).
AI: `AI_DRIVER` (mock / bedrock), `AI_MODEL_FAST|BALANCED|POWERFUL`, `ANTHROPIC_API_KEY`, `AWS_REGION`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `SES_FROM_DOMAIN`.
Google: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_OAUTH_REDIRECT_URL` (serves both Gmail and Sheets).
Test-only: `THROTTLE_DISABLED` (forbidden in production), `SEND_SCHEDULER=off`, `LIVE_DNS=1`.

---

## 11. Environment and tooling gotchas

- **Docker Desktop on this PC crashes on start** (stale-socket bug), most recently 2026-11-07 (`dockerInference` socket). Fix: kill Docker, `wsl --shutdown`, rename `%LOCALAPPDATA%\Docker\run` and `%LOCALAPPDATA%\docker-secrets-engine` to `.stale`, relaunch (sometimes two passes), then `docker start supersaas-postgres supersaas-redis`. Saved in memory as reference-docker-stale-socket-fix.
- Tests use `maxWorkers: 1` (parallel suites exhaust Postgres connections). The full API suite takes about 15–17 minutes. A run that never prints is stuck: kill it and rerun.
- Tests force `EMAIL_DRIVER=mock` and `AI_DRIVER=mock` (`apps/api/test/setup-env.ts`), so a real-sending `.env` is safe.
- Stop the dev servers before `next build`.
- Migrations: hand-written SQL plus a manual entry in `meta/_journal.json`; run `npm run db:migrate -w apps/api`.
- Authz matrix doc regenerates with `UPDATE_AUTHZ=1`.
- Multer is pinned through root `overrides` (nested form for platform-express) because npm kept reinstalling an old copy.
- Windows quirks: `prettier --write` on the web app picks the API's quote style (use ESLint only there); long multi-line edits go through script files.
- Run the app: `npm run dev -w apps/web` and `npm run start:dev -w apps/api`; demo login `demo@supersaas.local` after `npm run db:seed -w apps/api` (a local-only seed password).
- Packages added this period: `read-excel-file@9.3.10` (pinned), `next@16.4.2`, `react@19.2.9`, `eslint-config-next@16.4.2`.

---

## 12. Documents in the repo (`supersaas/docs/`)

`RUNBOOK.md` (deploy, restore, incidents, monitoring, scaling notes) · `SETUP-ACCOUNTS.md` (click-by-click AWS / Google / Bedrock) · `AUTHZ-MATRIX.md` (generated route × role table) · `COMPLIANCE.md` (CAN-SPAM, GDPR, cookies, sub-processors) · `SECURITY-REVIEW.md` (the review above, with re-run instructions) · `SESSION-HANDOFF.md` (cloud-session handoff; item 1 marked resolved). Also `scripts/security/pentest.js` (51 live checks).

---

## 13. Acceptance criteria (all met in code)

1 Isolated workspace on sign-up ✅ · 2 Leads visible, searchable, filterable, taggable, campaign-ready ✅ · 3 Senders selectable in campaigns ✅ · 4 SPF/DKIM/DMARC status + guidance ✅ · 5 Manual campaigns with templates, follow-ups, delays, sender rules ✅ · 6 AI builder collects context before drafting ✅ · 7 Launched campaign queues and sends within limits and rotation ✅ · 8 Reply appears in the inbox with thread and lead context, live ✅ · 9 Opens/clicks/replies/unsubscribes stored with timestamps ✅ · 10 Admin sees users, campaigns, activity, status ✅.
**Final sign-off (T10.1)** still needs a real send and a real reply through SES or Gmail polling.

---

## 14. PENDING

### 14.1 Merge and housekeeping (Claude, needs your go)
| Item | Note |
|---|---|
| ~~Merge `cloud-session` → `main`~~ | ✅ Done 2026-11-12 (fast-forward to `8afb3e3`) |
| Decide the co-author line on `cloud-session` commits | See §2 |
| Smart segments accept an **invalid tag id**; the refresh then fails silently | Found in code, not fixed |
| No browser tests yet for: adding a campaign step, adding leads to a segment, the Sheets import screens | Gaps in E2E |
| Playwright 1.64.1 expects browser build 1248; the cloud container ships 1243 | Only matters in that container |

### 14.2 Needs your real accounts (you)
| Item | Plan ref | What |
|---|---|---|
| Set `SYSTEM_SMTP_*`, test a reset + a notification | T1.3, T7.5 | Platform email |
| Connect a real Google Sheet, import, edit, Sync now | T2.8 | |
| One real **Connect Gmail** in the same browser | Security #4 | |
| Public HTTPS `API_URL` so links are not `localhost` | T10.3 | Fixes the spam problem. Options: cloudflared tunnel, a per-campaign tracking toggle, or a localhost warning in the UI |
| **AWS account** (IAM, billing alerts, us-east-1) | T0.3 | Unlocks the rest of this list |
| **SES** domain verification + production access (**2-week lead time, file first**) | T0.4, T3.2 | |
| Bedrock model access + about $200 budget | T0.6, T6.1, T6.4 | Real Claude for sequences, classification, drafts |
| Google Cloud project, OAuth consent + credentials | T0.5 | Testing mode refresh tokens expire after 7 days; sensitive-scope verification takes weeks |
| SES → SNS webhook (bounces and complaints into suppression) | T5.6 | Needs AWS |
| Reply ingestion (SES inbound + Gmail polling) | T5.7 | Needs AWS/MX. Until then replies enter only through the dev simulator or manually |
| S3 durable import storage | T2.5 | Needs AWS |
| Sentry (web + API) | T1.7, T10.5 | Needs an account/DSN |
| AWS cost alarms; a dedicated 1-minute uptime pinger; set repo variable `UPTIME_URL` | T10.5 | The 30-minute probe is idle until the variable is set |

### 14.3 Your decisions
D-A name + domain (also blocks contact email and postal address for legal pages) · D-B target market · D-C hosting (then T10.4 deploy) · D-D beta size and channel (then T10.7 onboarding of first users) · **email verification at sign-up** (closes finding 8) · legal review of `/privacy` and `/terms`, a customer DPA and a sub-processor list (T10.6) · Outlook sender: still deferred.

### 14.4 Launch tasks that follow
T10.1 final acceptance with a real send and reply · T10.3 deliverability check (seed inboxes, spam score, DKIM alignment, ramp plan) · T10.4 production deploy (API + workers behind Caddy, Vercel frontend, Postgres, Redis, S3, DNS, backups, env management) · T10.7 first-user onboarding.

### 14.5 Security recommendations not yet done (priority order)
1. Two-factor login for admins and managers before public launch.
2. Per-account login throttling (today it is per IP).
3. Email verification at sign-up.
4. Private networking for Postgres and Redis; TLS and a password on Redis; no public DB ports (`docker-compose.yml` is local-only).
5. Least-privilege AWS IAM instead of `*FullAccess` in the setup guide.
6. Audit log of sensitive actions.
7. `APP_ENCRYPTION_KEY` rotation plan (key versioning).
8. Dependabot/Renovate; the NestJS 12 upgrade to clear `js-yaml`.
9. Keep AI output human-reviewed; treat classifications as hints.
10. Strict `script-src` CSP with nonces after deploy.

### 14.6 Deferred by design
T8.1 daily roll-up worker (live queries are fine at beta scale) · Outlook OAuth sender · Stripe billing · WhatsApp / SMS / LinkedIn channels · full warm-up network · full custom-domain white-label · Elasticsearch · Datadog · video walkthroughs · GoHighLevel · fully automated AI replies · Brilliant Directories (cut).

---

## 15. Open ideas raised this period

### 15.1 Automatic "winner gets more leads" (A/B batches)
- **In the spec but not built.** Campaign Builder describes a weekly scoring `(Open × 0.3) + (Reply × 0.5) + (Click × 0.2)`; the **top 20% of variants are doubled** and **bottom 20% halved, then removed** if they fail again.
- **Built today:** subject-line A/B with even round-robin assignment and per-variant results. Version 3 plans the "A/B Analysis Upgrade" and the self-learning loop.
- **Still an open question in the spec:** test on a small group first, and resend the winner to the same people or to new ones.
- **Note for the 200-lead case:** batches of about 50 leads give only 1–3 replies each, too few to call a winner. Suggested design: 2–3 versions, send to 30–40% first, judge by **replies** (opens are unreliable), then send the remaining leads to the winner so nobody is emailed twice.

### 15.2 Gemini instead of (or beside) Bedrock
Possible and small: one new `gemini.provider.ts` implementing the same `generate()` interface, a `gemini` case in the resolver, env vars `GEMINI_API_KEY` and model names per tier, tests, and an eval run. It would unblock real AI without AWS. Use the paid tier for real customer data and list Google as a processor in `docs/COMPLIANCE.md`. **Not built.**

### 15.3 Startup Buildathon India 2026 submission
Fields: problem statement, proposed solution, solution architecture, Google AI tools (AI Studio / Antigravity / Agent Skills), Google AI models, pitch deck (PDF, max 5 MB, in the organisers' template, which we do not have yet). Decide **solo vs team before submitting** (switching later deletes the submission). SuperSaaS uses no Google AI today, so the Google fields should say "planning to use" only if that is true (see 15.2). Deadline unknown. Logged in _inbox.

---

## 16. Suggested order from here

1. ~~Merge `cloud-session` into `main`~~ ✅ done 2026-11-12.
2. **Public HTTPS `API_URL`** (tunnel) and re-send a Gmail test: fixes the spam placement.
3. Set **`SYSTEM_SMTP_*`**; test reset and notification emails; connect a real Sheet.
4. Decide **D-A…D-D** and sole/team for the buildathon; collect the pitch-deck template.
5. Optional, high value for the buildathon: **Gemini provider** and the **auto-pick-winner** campaign option.
6. Open the **AWS account** and file the SES request first (2-week wait), then Bedrock, then bounce/complaint and reply ingestion.
7. Deliverability check, deploy, then the first beta users.

---

## Related
- SuperSaaS product brief
- V1 Task Breakdown (task-level checklist)
- Spec Index
- _log · _inbox
