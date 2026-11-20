# SuperSaaS — Development Log

Running record of every work session: what was asked, what was decided, what
changed (with commits), and what is pending. **Newest first.** The full feature
and status picture is in [`BUILD-SUMMARY.md`](BUILD-SUMMARY.md); the task
checklist lives in the A2B vault (`Products/SuperSaaS/V1 Task Breakdown.md`).

How to keep this up to date: every session appends a dated entry at the top of
"Sessions" with (1) what Aman asked, (2) decisions, (3) changes + commits,
(4) tests run and results, (5) what's next.

---

## Sessions

### 2026-11-21 — Learning Loop T06: Insights (what works by location, send time, industry, role and more)

Built on `ll/T06` from `google-stack` `984344b`. No migration, no cloud, no AI. Read-only and exploratory.

- **Rules (`apps/api/src/insights/insight-rules.ts`, pure):** leader rule (a group needs 30 reached companies; "best" needs 3 events and
  its Wilson lower bound above the overall rate; "worst" when the upper bound is below it; otherwise "No clear leader yet" with the
  top group in grey; < 30 = "not enough data yet"), at most 5 headlines (largest significant gap first), confounding hint (a
  best bucket that is > 60% one value of another factor, and that value is 20+ points over-represented overall: "Most of these were
  also hiring. Compare within trigger before deciding."), fit-score (stars) warning, send-time honesty (<= 2 blocks used = "we can't
  compare times yet", never a "best time"), headline metric = confirmed qualified once >= 50% of interested replies are settled.
  One deviation from the brief: the "< 3 events" drop applies to being called best, not to being called worst (a bucket with
  almost no replies is exactly what "worst" should catch).
- **Timezone (`send-time.ts`):** send time in the company's own timezone (snapshot) via `Intl`, else the workspace zone (counted and labelled);
  blocks 6-8 ... 20-22, "other" outside. 04:30 UTC to Asia/Kolkata = 10:00 = the 10 am-12 block.
- **Source (`types.ts`, `postgres-insights.source.ts`, `aggregate-insights.ts`):** `InsightsSource` interface (`factorFunnel`, `sendTimeGrid`, plus
  one-pass `all`) returning one fixed row shape; `PostgresInsightsSource` reads one row per company from snapshots, step-1 sends, real
  opens and CURRENT outcomes inside `withOrgContext`; `INSIGHTS_SOURCE=postgres|bigquery` (bigquery says "arrives with T07").
  `source-contract.ts` is the shared contract T07's BigQuery source must pass. 17 factors (country, region, city, industry, size,
  trigger, role, lead source, stars, mail provider, send day, send hour, sequence step as a distribution, subject version, sender,
  subject length, personalised subject) plus the day x hour heatmap; funnel (discovered -> eligible -> reached -> bounced -> opened ->
  replied -> qualified -> booked) for the 6 Discover-searchable factors. Unit = reached company (sent, not bounced); one company is one
  row; a reply not tied to the company's enrollment is never credited.
- **API:** `GET /insights?offerId&campaignId(,..)&from&to`, all roles, cached 10 minutes per workspace + filters in Redis (fails open;
  cache key is versioned so a changed response shape is never served stale after a deploy). In `docs/AUTHZ-MATRIX.md`.
- **Web:** `/review/insights` (sidebar Review now opens it; `Insights | Replies to confirm` tabs): filters (offer, campaign, date range,
  metric), headline cards with the exploratory note and a disabled "Test next batch" on searchable factors, fit-score warning, send-time
  heatmap (low-data cells hatched; says how much is in recipient vs workspace time), a section per factor (bars with n and the 95% range,
  "unknown" always visible, funnel table). Metric switch changes headlines and bars (per-metric headlines come from the API).
- **Seed:** `npm run seed:experiment -w apps/api` now also adds "Insights demo: clinic outreach": 400 companies, 4 cities, 3 industries,
  varied send times, with a confounded Pune effect, Tue-Thu morning and founder effects, and random stars.
- **Checked by hand:** API vs an independent SQL count over the seeded demo: city (Pune 108/23/10, Delhi 107/10/2, Mumbai 96/6/3,
  Bengaluru 83/12/6 reached/replied/qualified) and trigger (hiring 162 reached, 17 qualified, 36 replied) match exactly.
- **Tests:** `insight-rules.spec.ts` (28: leader rule, headlines, confounding, stars, send-time honesty, timezone), `insights.integration.spec.ts`
  (15: one company per two contacts, bounce/provisional/unattributed handling, recipient timezone + workspace fallback, narrow send window,
  filters, Discover funnel, unknown buckets, simulated data excluded, cross-workspace isolation, roles, cache) and a Playwright spec.

### 2026-11-21 — Learning Loop T05: Review API, read-only Review tab and "Try simulation"

Built on `ll/T05` from `google-stack` `3f76e84`. Read-only: it computes and shows; approve buttons arrive in T11/T12.

- **Migration `0055_reviews.sql`:** `reviews` (revision per experiment, `inputs`, `result`, `explanation`,
  `explanation_source`, `inputs_hash`, `simulated`, `scenario`), `UNIQUE (experiment_id, revision)`, RLS + `owner_bypass`.
  Simulated rows have `simulated = true` and no experiment; a CHECK keeps real rows tied to an experiment.
- **Aggregation (`review/review-data.service.ts`, `review-aggregate.ts`):** one per-company SQL row set inside
  `withOrgContext`, then a pure `aggregate()` (also used by the simulation, so both are counted identically). Unit = company:
  two contacts = one company; opens = real opens only (bots are stored as `bot_open`); qualified/booked = the CURRENT
  verified outcome inside the response window from the company's first send (late replies stored, not counted);
  provisional AI labels shown as "unconfirmed", never counted; window closed / earliest full read from first sends;
  outcome coverage from the T03 helper; unattributed + ambiguous flags from T03. Audience slices by city / industry /
  trigger (buckets under 10 companies fold into "other", "unknown" always shown), labelled exploratory.
  `delivered` = sent minus bounced for real data (so a delivery imbalance without a bounce-rate breach can only appear in a simulation).
- **Endpoints (`review/`):** `GET /campaigns/:id/review` (computes once if none yet, `404 no_experiment` otherwise),
  `POST /campaigns/:id/review/refresh` (admin/manager; unchanged inputs keep the revision, any change saves N+1; 1 per 30 s
  per campaign, in memory, fine while the API is one instance), `GET /reviews/:id`, `GET /review/scenarios`,
  `POST /review/simulate`. All in `docs/AUTHZ-MATRIX.md`. Explanation = the T04 deterministic template (`explanation_source = template`).
- **Simulation (`review/simulation.ts`):** 5 scenarios (`valid_winner`, `inconclusive_small`, `high_open_low_conv`,
  `delivery_imbalance`, `misleading_city`), fixed seed, exact counts, same aggregate + policy as real data; stored with
  `simulated = true`, never touches real tables, never returned by real-results queries.
- **Web:** campaign page gets Setup / Review tabs; Review shows the goal strip (status pill, decision date, revision, Refresh),
  variant table with a source tooltip on every number (opens greyed as diagnostic), lift card with interval bar and the
  minimum-lift line, the 8 checks, the recommendation card (buttons disabled: "Arrives in the next update"), slices, and
  a "Try simulation" dropdown with a yellow SIMULATED DATA banner and "Back to real results". Also fixed the campaign
  detail pane overflowing sideways (`min-w-0`) and the T03 unconfirmed badge using a token that does not exist.
- **Seed:** `npm run seed:experiment -w apps/api` (`review-demo@supersaas.local`, local only) builds a running experiment with
  80 companies, opens, bounces, replies, verified outcomes and 2 unconfirmed AI labels.
- **Tests:** `review.integration.spec.ts` (21: one company per two contacts, late reply excluded, provisional not verified,
  unattributed flag, revisions only on change, audit link, simulations isolated, cross-org 404, roles, 429), `simulation.spec.ts`
  (7), and a Playwright spec (`apps/e2e/tests/review.spec.ts`) that opens the seeded Review tab, runs a simulation and sees the banner.

### 2026-11-21 — Learning Loop T04: Review statistics library and decision policy (pure code)

New folder `apps/api/src/review/policy/` (`POLICY_VERSION = 'review-policy/1'`): no database, no AI, no Nest.
It imports only siblings and Node `crypto`, and a test enforces that. T05 wires it to data and screens.

- **`stats.ts`:** Wilson interval, Newcombe hybrid-score interval (method 10) for a difference, inverse normal
  (Acklam), sample size per arm (`lower_bound` promotion rule and classic `significance`), sample-ratio-mismatch
  chi-square and a two-proportion test.
- **`gates.ts`:** the 8 gates (window mature, outcome coverage, assignment balance, delivery balance, attribution
  clean, copy frozen, guardrails, minimum sample), each with plain-words reason and next-check date.
- **`decide.ts`:** one decision: `guardrail_breach` (checked first, it is urgent), `keep_collecting`, `promote`
  (challenger lower bound >= minimum lift, or keep control + propose pausing a clearly worse challenger), or
  `inconclusive` (with sample needed, or "not worth continuing" when that is > 3x current n). Allowed actions with
  stable ids, findings `F1..Fn`, opens shown as a labelled diagnostic only. Never forces a loser.
- **`explain-template.ts`:** deterministic plain-English explanation in the T09 shape `{summary, points[{text, findingIds}]}`.
- **Input additions beyond the brief:** `earliestFullRead` (so "window not mature" can give a date), optional
  `reviewId` (action ids) and `expectedShareControl` (default 0.5).
- **Reference checks:** Newcombe (1998) 56/70 vs 48/80 -> 0.2000, (0.0524, 0.3339) matches to 4 decimals. Other values come
  from an independent pure-Python implementation of the same formulas (statsmodels was not installed; not statsmodels output).
- **Sample size table:** baseline 3%, target +4 pp, min +2 pp, lower-bound rule = **1,849 companies per arm**.
- **Tests:** 90 tests in 4 suites, `policy/` at 100% statements/branches/functions/lines (named fixtures: valid winner,
  small sample, high opens/low conversion, delivery imbalance, SRM, guardrail breach, immature window, low coverage,
  clearly worse challenger, plus snapshot determinism). README in the folder explains each gate in plain words.

### 2026-11-21 — Learning Loop T03: Outcome events, attribution and human verification

Aman had T01 and T02 built in another tool (commits `766eec8`, `e0b2d16` on `ll/T02`); they were re-checked here
(migrate, lint, API tests, API build all fine) and T03 was built on `ll/T03` from `ll/T02`.

- **Migration `0054_outcome_events.sql`:** `outcome_events` (type, source, verification, company_key,
  experiment/variant, conversation, sent_email, `supersedes_id`, `UNIQUE (org_id, idempotency_key)`, RLS +
  `owner_bypass`), the SQL view `v_outcomes_current` (`security_invoker`, so tenant RLS applies), and
  `org_knowledge.qualification_rubric`. Corrections never update in place: they insert a superseding row.
- **Producers (`apps/api/src/outcomes/`, hooked into existing code):** every reply (`reply`, verified, key = message id,
  source `gmail_sync` or `system`); AI `interested` also a **provisional** `qualified_reply` (key per conversation);
  Gmail bounce and the unsubscribe link -> verified events; the inbox "converted" toggle -> `booked_call` (verified when
  a manager/admin does it, provisional for an agent; un-converting inserts a superseding rejected row).
  Recording is best-effort inside a savepoint, so it can never break the reply/bounce/unsubscribe itself.
- **Attribution:** enrollment from the thread (conversation / sent email), company key from the frozen snapshot (fallback
  lead), experiment + variant from the email's own ids or the company's assignment. No match, or a lead in several
  campaigns with no In-Reply-To, stays **unattributed** (flagged in `reason`), never guessed.
- **API:** `GET /outcomes`, `GET /outcomes/unattributed`, `GET /outcomes/history/:conversationId`, `POST /outcomes`
  (manual, client idempotency key), `POST /outcomes/:id/verify` (all roles; changing an earlier decision needs a reason),
  `GET /experiments/:id/outcome-coverage`, `GET|PUT /review/rubric` (PUT admin/manager). In `docs/AUTHZ-MATRIX.md`.
- **Web:** Inbox shows "AI: qualified reply (unconfirmed)" with **Confirm qualified / Not qualified**, who confirmed and
  when, change-with-reason, the workspace rubric next to the buttons, and the old Convert button is now **Booked a call**;
  new `/review/outcomes` queue (waiting for a decision + not tied to a campaign) in the sidebar as **Review**; Settings
  has the rubric editor.
- **Notes:** no code path produces `complaint` events yet (no SES webhook exists); the type, key and view support it.
  `outcomeCoverage` = replying companies with no AI "qualified" label still waiting for a person / replying companies
  (inside each company's response window); 1 when nobody replied. Unsubscribe events key on the enrollment (the link
  carries no sent-email id), pointing at that enrollment's latest email.
- **Tests:** `outcomes.integration.spec.ts` (provisional + attribution, question != qualified, same-company variant,
  duplicate delivery -> one event, late reply stored, unattributed list, correction chain with history, agent can verify,
  cross-org 404 + empty, converted/un-converted, unsubscribe once, bounce, manual idempotency, coverage, rubric roles)
  and `outcome-logic.spec.ts`.

### 2026-11-20 — Learning Loop T01 + T02: Company key, Discover attributes, Offers, enrollment snapshot, experiments and stable company-level assignment

- **T01 (finished & rebased onto `google-stack` `65ad84a`):**
  - Migration `0052_company_key_attributes.sql` + idempotent `company_key` backfill for existing leads and prospects.
  - Shared `INDUSTRIES`, `SIZE_BANDS`, `TRIGGER_TYPES` (`hiring | expansion | funding | product_launch`) and `MAIL_PROVIDERS` (`packages/shared/src/attributes.ts` + `apps/api/src/leads/attributes.ts`).
  - `companyKey(email, website?)` (`apps/api/src/leads/company-key.ts`), MX-based `MailProviderResolver` + Redis 7-day cache + background BullMQ `mail-provider` queue (`apps/api/src/leads/mail-provider.ts`, `mail-provider.service.ts`), code-derived IANA timezone (`timezoneFor`), and verbatim quote verification for triggers and location (`apps/api/src/prospects/attributes.ts`).
  - Web UI chips for city, inferred industry/size, and quoted triggers on `/discover`, plus `company_key`, `mail_provider`, `timezone`, and location on `/leads/[id]`.
  - Unit tests (`company-key.spec.ts`) + `prospects.integration.spec.ts` passing.
- **T02 (Offers, enrollment snapshot, experiments and stable assignment):**
  - Migration `0053_offers_experiments_assignments.sql`: `offers` table (`campaigns.offer_id`, `prospect_runs.offer_id`), `campaign_leads.snapshot jsonb`, `experiments` (with partial unique index `WHERE status = 'running'` on `(campaign_id, step_id)`), `experiment_variants`, `experiment_assignments` (`UNIQUE (experiment_id, company_key)`), `sent_emails.experiment_id` + `variant_id`, and `FORCE ROW LEVEL SECURITY` + `owner_bypass` on every new table.
  - **Offers (`offers.service.ts`, `offers.controller.ts`):** `GET /offers` auto-creates `"Default offer"` per workspace on first use; `POST /offers` and `PATCH /offers/:id` manage offers; wired into campaign create/edit and Discover runs.
  - **Enrollment snapshot (`snapshot.ts`, `campaigns.service.ts`):** `roleBucket(title)` maps job titles to `founder_owner | c_level | vp_head_director | manager | individual | unknown`; `enroll()` and `schedule()` write the 19-key frozen `snapshot` once at enrollment (never updated on later lead edits).
  - **Experiments & freeze guards (`experiments.service.ts`, `experiments.controller.ts`):** `POST /campaigns/:id/experiments`, `GET /campaigns/:id/experiments`, `GET /experiments/:id`, `PATCH /experiments/:id`, `POST /experiments/:id/start`, `POST /experiments/:id/stop`. Running experiments freeze variant copy, template copy, audience segment, sender list, and step delays (`409 experiment_running`: `"Editing copy creates a new test. Stop this one first."`).
  - **Send-path company assignment (`experiment-assignment.ts`, `send.service.ts`):** deterministic `sha256(experiment_id + ':' + company_key)` -> uniform `[0, 1)` over active variants (50/50 in V1), inserted with `ON CONFLICT (experiment_id, company_key) DO NOTHING` in Phase 1 before dispatch. Colleagues at the same company and retries after provider errors share the same variant; leads without `company_key` are stopped with `stop_reason = 'experiment_ineligible'`; follow-up steps copy `experiment_id` and `variant_id` onto `sent_emails`; legacy campaigns keep round-robin untouched.
  - **Web UI (`offer-select.tsx`, `experiment-panel.tsx`, `campaigns/page.tsx`, `campaign-wizard.tsx`, `winner-panel.tsx`, `discover/page.tsx`):** Offer selector with inline `"+ New offer…"`, Step 1 `"A/B test (company-level)"` panel with Start/Stop and frozen state, and legacy rotation relabelled `"Legacy rotation (not a test)"`.
  - **Tests:** `experiment-assignment.spec.ts` (10,000-company 50/50 split, paused variant stability, `roleBucket`, snapshot keys), `experiments.integration.spec.ts` (20 leads across 12 companies, colleague sharing, retry on provider error, concurrency, `experiment_ineligible`, follow-up attribution, 409 freeze checks, snapshot immutability, RLS, legacy regression), `authz-matrix.integration.spec.ts` (`docs/AUTHZ-MATRIX.md` updated), `rls-isolation.spec.ts`, and `rls-owner-bypass.spec.ts` all green.

### 2026-11-19 — "Can't log in: Something went wrong, try again"

**Cause:** environment, not code. After the PC restarted, Docker Desktop was not
running (so Postgres/Redis were down) and only the web app had been started, not
the API. The login page shows "Something went wrong" whenever the API doesn't
answer; a wrong password shows "Invalid email or password" instead.

**Fix:** Docker restarted with the stale-socket rename fix, containers started
(healthy), API started (`/health/ready` = db + redis OK). Verified: bad password
→ 401 "Invalid credentials"; demo login → dashboard; Gemini key still valid
(`gemini-3.5-flash-lite` answers in ~1 s; `gemini-3.8-flash` "high demand"
again, covered by the automatic fallback). Repo unchanged (`90a1362`, clean).

**Then (Aman):** "make the fast model default for drafts". Done: the balanced
tier (reply drafts, Ask AI to edit) now defaults to `gemini-3.5-flash-lite`; the
campaign builder keeps `gemini-3.8-flash` with the Flash-Lite fallback. Live:
reply drafts 1.2 s and 6.0 s, edit 1.2 s (before: often 45 s+ waiting on an
overloaded 3.8 Flash). Tests updated (fallback tests now on the powerful tier).

**Then (Aman):** "login is a mess, the password reset link isn't working,
which service are we using? Generation failed."
- **Generation failed** = Google's own server deadline: `504 DEADLINE_EXCEEDED` on
  `gemini-3.8-flash` (campaign builder). Retry/fallback only knew 503 and our
  timeout, so it failed at once. Fixed: 504 / `DEADLINE_EXCEEDED` is retryable in
  `AiService` and triggers the Flash-Lite fallback. Live: builder returned a full
  3-email sequence (HTTP 200, 52 s; written by the fallback after 3.8 Flash hit
  the deadline). Test added.
- **Password reset:** no reset had ever been created: the email Aman used has no
  account in this local database (only the demo account and old test accounts
  exist). By design the reset page never reveals whether an email exists. Also
  no platform email service is configured (`SYSTEM_SMTP_*` empty): resets and
  notifications are only printed in the API log until an SMTP mailbox is set
  (e.g. Gmail SMTP with an app password).

**Then (Aman):** "make the builder use the fast model too; I've done the app
password."
- Campaign builder (powerful tier) now also defaults to `gemini-3.5-flash-lite`
  (all tiers fast). Live: full 3-email sequence in **8.4 s** (was 52 s). Stronger
  models stay one setting away (`GEMINI_MODEL_*`). Prompt-tuning note: one
  follow-up used `{first_name}` without a fallback.
- Platform email (`SYSTEM_SMTP_*`, smtp.gmail.com:587) is filled in, but Gmail
  **rejects the login** (`535 5.7.8 Username and Password not accepted`), with
  and without the spaces in the app password. Likely: the app password belongs to
  a different Google account than `SYSTEM_SMTP_USER`, or was mistyped. Waiting on
  Aman to re-create it. No reset email can be sent until then.

**Then (Aman):** received his own test campaign email showing the sender as
"amanxavier271"; "no option to edit the name". Also: opened the email and replied
from another account, but the workspace shows neither the open nor the reply.
"Is it because it's running locally? Should we host it?"
- **Sender name:** Gmail senders connected without a name take the part of the
  address before "@". The API could already rename (PATCH /senders/:id) but the
  UI had no button. Added: a pencil **Edit** per sender in Settings → Senders
  (name recipients see, reply-to, signature; reply-to/signature can be cleared),
  and a "Name recipients see" box next to **Connect Gmail** so new senders get a
  proper name. Reconnecting keeps the existing name. Verified via API + browser.
- **Mistake, reverted:** the API check renamed the first sender returned, which
  was Aman's real Gmail sender (to "Dana from Demo" + a test signature) instead
  of the fake demo one. Reverted within a minute to its exact previous state
  (name `amanxavier271`, no reply-to/signature, still verified). No mail was sent
  in between. Lesson: test edits only on a sender picked by its address.
- **Opens not recorded:** tracking pixel and links point at
  `http://localhost:4000`. Gmail loads images through Google's servers, which
  can't reach a laptop, so no open is ever recorded (links/unsubscribe also
  break on other devices). Needs a public HTTPS `API_URL` (tunnel or hosting).
- **Replies not showing:** reply reading from Gmail is **not built yet** (T5.7 /
  google-stack Phase 2). Today replies only enter via the Test reply tool.
  Hosting alone won't fix this.

**Then (Aman):** "yes, start building Gmail reply reading; can this run on
Vercel?"
- **Built Gmail reply reading (T5.7 / google-stack Phase 2):**
  `GmailReplySyncService` polls every 2 min (system job `gmail-reply-sync`) and
  on **Inbox → Sync Gmail** (`POST /inbox/gmail-sync`). Replies from people we
  emailed → `ingestReply` (quote-stripped, classified, sequence stopped);
  mailer-daemon bounces → suppression `bounced` + stopped sequences + bounce
  event; everything else ignored and never stored (only the Gmail id, in
  `gmail_seen_messages`). Connect Gmail now also asks for `gmail.readonly`
  (optional: sending works without it). Settings shows per-sender reply-sync
  status; revoked tokens mark the sender for reconnect. Migration `0045`
  (columns `reply_sync_at/error`, table `gmail_seen_messages` with RLS,
  definer fn `due_gmail_reply_syncs`). 4 integration tests (reply, personal
  mail ignored, bounce, no double-processing, Sync now, revoked token).
- **Vercel:** the web app can run on Vercel; the API can't (long-running
  workers, the 2-minute jobs, websockets, Redis connections). API needs a server
  or container host; database + Redis managed elsewhere.
- Full suite found 1 failure in usage limits (CSV import over the lead cap):
  not a bug. The dev API running against the same Redis grabbed the test's
  import job. Fixed at the root: BullMQ uses `QUEUE_PREFIX` (tests get a
  private `test-<pid>` namespace via `test/setup-env.ts`). Usage + import suites
  now pass with the dev API running.
- **To try it for real:** Aman reconnects Gmail in Settings (tick the new "read"
  permission), then replies to a campaign email from his other account and
  clicks Sync Gmail.
- Full suite with the dev API running: 51/51 suites, 292 passed, 1 skipped.
  Committed + pushed to `google-stack` as `88b308a`.

**Then (Aman):** "give me the complete walkthrough of running this locally …
then an Excalidraw with every page and the complete architecture, done in
blue, half-done in yellow, not done in red."
- **`docs/RUNNING-LOCALLY.md`:** folders and paths, branch choice, prerequisites,
  first-time setup (`npm install`, `.env` keys with what each one turns on,
  Docker, migrations, seed, operator grant), daily two-terminal run, ports,
  after-reboot order, tests / E2E / eval, testing real features in the UI
  (Gmail replies, opens need a public URL, cloudflared), troubleshooting table.
- **`docs/architecture/`:** `supersaas-architecture.excalidraw` (top-to-bottom:
  users → frontend pages (2a public/auth, 2b app pages, 2c shared UI, 2d direct
  API traffic) → backend (cross-cutting, 18 modules, queues/jobs) → data →
  external services → infrastructure → 7 end-to-end workflows → what's left →
  design notes), status colours blue/yellow/red plus the status in words,
  `*` for google-stack-only. `README.md` explains how to read it;
  `generate.py` rebuilds it from content lists; PNG/SVG preview for GitHub.

**Then (Aman):** reply sync works live, but opens/clicks don't; "let's host it" on
Google Cloud: Cloud Run + Cloud SQL, Mumbai, buildathon billing; Claude runs the
gcloud commands, explaining each. Also: a light (Twenty CRM) theme option.
- **Why opens/clicks were 0:** the pixel and links point at `localhost`; Gmail
  fetches images from Google's servers, which can't reach a laptop. Hosting fixes it.
- **Cloud SQL blocker found and fixed (migration `0046`):** Cloud SQL has no
  superuser, so FORCE RLS applied to the owner and every SECURITY DEFINER
  function (login, scheduler, reply sync) would have seen zero rows. Reproduced
  locally with a non-superuser-owned database (16/23 failing), fixed with an
  owner-only `owner_bypass` policy per RLS table (app role still isolated),
  guarded by `rls-owner-bypass.spec.ts`. Full suite on that database: green.
- **Production pieces:** `src/db/migrate.ts` (runtime migrator, sets the real
  `supersaas_app` password from `APP_DB_PASSWORD`), API listens on `PORT`,
  `COOKIE_PATH_PREFIX`, BullMQ keeps Redis username + TLS (`rediss://`, Upstash),
  operator-only `GET /operator/request-ip` (to set `TRUST_PROXY` live),
  Dockerfiles for api + web, web proxies `/api/*` to the API (first-party cookies
  across two run.app hosts) with the websocket direct, `.dockerignore` /
  `.gcloudignore`, `deploy/cloudbuild-*.yaml`, `docs/DEPLOY-GCP.md`. Verified with
  both images running locally: sign-up, reload (refresh via proxy), websocket.
- **Settings → Appearance:** Light (Twenty CRM style) / Dark / System cards,
  synced with the header toggle.
- **System email 535 solved:** `SYSTEM_SMTP_USER` had a typo (`@gmail.comm`).
- **Local "Can't reach the server":** Docker Desktop's `wslrelay` took IPv6
  `localhost` on 5432/6379; `.env.example` now uses `127.0.0.1`.
- **Google Cloud so far (project `supersaas-513613`):** APIs enabled, Artifact
  Registry `supersaas`, Cloud SQL `supersaas-db` (PG16, db-f1-micro, backups,
  deletion protection) + database, 9 secrets, service account `supersaas-run`.
- Tests: 296 passed / 1 skipped (dev DB) and green on the Cloud-SQL-style DB.

**Then (Aman, 2026-11-19 evening, after go-live):** "give me HTML email templates
for the starters, minimal and like the app theme, with reply / visit website
buttons; make them the default"; then "update the existing templates too".
- **Live fixes first:** Connect Gmail on Cloud Run failed with Google's "OAuth
  client was not found": a trailing space after `GOOGLE_CLIENT_ID` in `.env` was
  copied into Cloud Run (dotenv trims locally). Env fixed; code now trims the id
  and secret. First live campaign landed in the recipient's All Mail (filed
  outside Primary, likely Promotions); open tracking confirmed live
  (`GoogleImageProxy` hits on `/t/o`).
- **Starter templates redesigned** (`default-templates.ts`): one shared
  email-safe layout (tables + inline styles, white card, hairline borders, Inter,
  indigo `#3e63dd`). Cold intro: Reply + Visit website. Follow-ups, break-up and
  meeting request: one-tap quick-reply chips (mailto: replies with prefilled
  text, so reply sync and classification pick them up). Case study: highlight
  box, ticked points, See how it works + Reply. New tokens `{sender_email}`
  (reply-to else From), `{sender_company}` (workspace name), `{sender_website}`
  (workspace website, https:// added; falls back to a reply link when empty).
  Unsubscribe footer restyled to match. A parallel session added
  `default-templates.spec.ts` (15 tests).
- **Migration `0047`:** replaces a workspace's starter template only where name,
  subject and body are still exactly the old default (edited ones untouched).
  Locally: 175 starter rows updated.

**Then (Aman, 2026-11-20):** templates live (`52ae671`: images rebuilt, migration
job ran `0047` on Cloud SQL, API + web redeployed). New problem: an imported
LinkedIn-scraped list showed post JSON in Company, "Verified" as status and no
email, and the long values blew up the leads table. "Can we use AI to auto-match
the lead CSV?"
- **Cause:** the column matcher mapped any header that merely contained a field
  name (`company_recent_post` → company, `email_status` → status), and the
  importer stored whatever it got (no email format check, no length limit,
  any status text).
- **Column matching rebuilt** (`leads/import/column-mapping.ts`): rules use exact
  header meanings (synonyms) checked against the sample values (an email column
  must hold emails; JSON / URLs / paragraphs never fill a short field) and spot an
  email column by its values. **AI matching** (`POST /leads/import/suggest-mapping`,
  admin/manager, 20/min): headers + up to 5 truncated sample values per column go
  to the fast model (structured output: column → field); the answer is never
  trusted as-is (allowed fields only, one column per field, same value checks),
  gaps filled from the rules; mock AI or failure → rules. The import screen
  matches automatically on upload (file or Google Sheet), shows an example value
  under every column, says "Matched with AI", has an Auto-match button, readable
  field names, and a new **Full name** field (split into first + last).
- **Importer cleans rows** (`import.processor.ts`): invalid email → left empty;
  over-long / JSON values in name, company, title, phone, source → left empty;
  status kept only if the workspace knows it (system + custom). Each affected
  row reports "Imported without: …".
- **Leads table:** company and email cells stay on one line (ellipsis + full
  value on hover).
- Tests: `column-mapping.spec.ts` (6, built on the failing list's shape) + 2
  import integration tests (messy rows cleaned; suggest endpoint).

**Then (Aman):** "there is no option to delete leads" (I had told him to bulk
delete; that didn't exist: only one-by-one from a lead's page).
- **Bulk delete** (`POST /leads/bulk-delete`, admin/manager; agents refused like
  the single delete): selected ids (max 500), or `allMatching: true` + the
  current filters ("Select all N" appears when the whole page is ticked and more
  leads match). An empty request is refused (400). RLS keeps it to the caller's
  workspace. List, export and bulk delete now share one filter builder.
  Leads page: red **Delete** in the selection bar with a confirm that says what
  goes with the leads. Integration test + verified in the browser.

**Then (Aman, 2026-11-20):** the live site went down: the buildathon billing
account closed ("billing is disabled for this project"); Cloud SQL suspended
(BILLING_ISSUE). Aman linked a new event-credit billing account; Cloud SQL
resumed by itself at 06:48 UTC, but both Cloud Run services stayed on Google's
503 page until forced onto a new revision (`gcloud run services update
--update-env-vars=RESTARTED_AT=...`). Lesson: after a billing outage, restart
both services. Decision: move the database to Supabase (free) so the
buildathon build doesn't depend on Google Cloud credits; new branch
`hackathon` for that work.

**Email confirmation at sign-up** (Aman: "only after clicking the link from the
mail should they get into the platform"):
- Migration `0048`: `users.email_verified_at` (existing users set to confirmed so
  nobody is locked out) + `email_verifications` (SHA-256 of token, single use,
  24 h, like password resets).
- Sign-up creates user + workspace but returns `{ verificationRequired, email }`
  and no session; emails "Confirm your email" with a button to
  `/verify-email?token=`. `POST /auth/verify-email` confirms and signs in
  (token pair, refresh cookie). Login with a correct password but unconfirmed
  email → 403 `EMAIL_NOT_VERIFIED` (wrong password still 401, so no account
  probing). `POST /auth/resend-verification` always `{ok:true}`, retires older
  links, 3 per 10 min per IP. Invite registrations are confirmed by the invite.
- Switch `EMAIL_VERIFICATION=on|off`; blank = on in production, off in dev/tests
  (E2E sets off).
- System emails (confirmation, password reset, notifications) now use the
  app-theme layout: grey canvas, white card, SuperSaaS header, indigo button,
  copy-paste link fallback.
- Web: "Check your inbox" panel with Resend after sign-up and on login;
  `/verify-email` page signs in and goes to the dashboard.
- Test: `email-verification.integration.spec.ts` (sign-up without session, login
  refused only with the right password, resend retires old links, link works once
  and signs in, existing users confirmed).

**Then (Aman):** email confirmation deployed live (`c65a2d7`, migration 0048 on
Cloud SQL). New branch **`hackathon`** (from `google-stack`; all buildathon work
goes here only; `main`, `google-stack`, `cloud-session` kept). Supabase MCP added
in `.mcp.json` (project ref only); the Supabase move runs as a separate task
session. "Redis is using so many commands, optimise it."
- **Measured** (local API, `redis-cli MONITOR`, 2 min idle): 221 client calls /
  1,135 operations; each BullMQ worker woke every 5 s (`drainDelay` default)
  and ran a stalled check every 30 s.
- **Fix:** shared `WORKER_OPTIONS` on all 4 queues: `drainDelay` 300 s,
  `stalledInterval` 300 s (`REDIS_IDLE_POLL_SECONDS`). New jobs still start
  instantly (adding a job wakes the worker); repeatables still fire on time.
  Result: 108 client calls / 575 operations per 2 min (−51%).
- **Limit found:** BullMQ hard-codes a 10 s maximum block when a queue holds a
  delayed job, so the queues with repeatable jobs (campaign-send 30 s tick,
  system-jobs) still wake every 10 s. Next option (needs Aman's go): run the
  repeating ticks from an in-process timer with a Redis lock instead of BullMQ
  repeatables.

**Start order after a reboot:** Docker Desktop → `docker start
supersaas-postgres supersaas-redis` → API (`npm run start:dev -w apps/api`) →
web (`npm run dev -w apps/web`).


### 2026-11-18 — Branch `google-stack`: Gemini as the AI (Phase 1)

**Asked:** "We are using Bedrock, right? Create a new branch where everything is
Gemini and Google. What changes, is it technical, does the output differ?" Then,
after the overview: "Bedrock is our main thing, but I don't have Bedrock now. For
testing, create a new branch (not main) with all the Google things. Don't remove
anything. We have to test it with the real AI. Ask if in doubt, else start Phase 1.
Keep all logs in the repo: what we've done, what we're doing, today's changes."

**Answered (overview):** yes, the code is built for Bedrock, but Bedrock has never
run (no AWS account), and SES is only a placeholder, so moving to Google loses
nothing. Mapping: AI → Gemini (small change behind the existing AI socket);
bulk sending → Gmail/Workspace mailboxes (Google has no SES equivalent);
platform emails → Workspace SMTP relay; reply reading → Gmail API (needs a
restricted scope + Google security review before public launch); bounces → parse
Gmail "undeliverable" messages; S3 → Cloud Storage; hosting → Cloud Run + Cloud
SQL + Memorystore. Screens unchanged; AI writing style differs slightly
(measured with the eval scorecard).

**Decisions (Aman):**
- Bedrock stays the main AI path; `main` is untouched.
- New branch `google-stack` from `main` (`8afb3e3`) for testing with Google.
- Don't remove anything (Bedrock, SES, mock all stay); Gemini is selected by
  `AI_DRIVER=gemini`.
- Start with Phase 1 (Gemini AI). Phases 2–3 later.
- Keep a full log in the repo (this file + `BUILD-SUMMARY.md`).

**Changes (branch `google-stack`):**
- New `apps/api/src/ai/providers/gemini.provider.ts` using `@google/genai@2.32.0`
  (pinned; 3.x releases were under two weeks old). Gemini API key or Vertex AI;
  model per tier overridable; JSON mode with the same JSON Schemas; thinking-token
  headroom; usage incl. thinking tokens logged; empty answers become clear errors.
- Resolver: `AI_DRIVER=gemini`. Registered in `AiModule` and `scripts/eval.ts`.
- Retries now also cover Gemini's `RESOURCE_EXHAUSTED` / `UNAVAILABLE`.
- Boot check: `AI_DRIVER=gemini` without `GEMINI_API_KEY` (or without
  `GOOGLE_CLOUD_PROJECT` on Vertex) refuses to start with a clear message.
- `.env.example`: `GEMINI_API_KEY`, `GEMINI_USE_VERTEX`, `GOOGLE_CLOUD_PROJECT`,
  `GOOGLE_CLOUD_LOCATION`, `GEMINI_MODEL_FAST|BALANCED|POWERFUL`.
- Docs: new `docs/GOOGLE-STACK.md`; pointers in `SETUP-ACCOUNTS.md`; AI
  sub-processor note in `COMPLIANCE.md`; this log and `BUILD-SUMMARY.md` added.
- Tests: `gemini.provider.spec.ts` (5), resolver test (Bedrock/Gemini selection),
  env test (Gemini key/project). All pass without network (Jest forces the mock).

**Later the same day:**
- Aman: written summaries in this log are enough; **no raw chat transcripts** in
  the repo. Log by what gets pushed.
- Aman added `AI_DRIVER=gemini` and `GEMINI_API_KEY` to `.env`. First live call
  (list models, then a one-line `generateContent`) was **refused by Google:
  `403 PERMISSION_DENIED`, reason `ACCESS_DENIED` on
  `generativelanguage.googleapis.com`**. The key itself has the right shape (an AI
  Studio `AIza…` key), so this is an account/project setting on Google's side,
  not our code. Waiting on Aman to check the key's project (Generative Language
  API enabled, no API restriction blocking it, account allowed to use Gemini).
- First full test run on this branch failed 5 suites with Postgres connection
  timeouts: Docker had just been restarted (stale-socket fix). Re-running one of
  them alone passed; the full re-run is **green: 50 suites, 283 passed, 1 skipped**
  (live DNS, by design). Lint clean. Eval pipeline proven on the mock.
- Aman enabled the Gemini API and asked to retry: still `403 ACCESS_DENIED` on
  3 attempts over 2 minutes (not propagation; a switched-off API answers
  `SERVICE_DISABLED` instead). Suggested: a fresh key from AI Studio via "Create
  API key in new project", or check the key's project / API restrictions.

- **New AI Studio key works.** Live model list checked: Gemini 2.5 models are
  closed to new users (404) and Pro models have no free-tier quota, so defaults
  became `gemini-3.5-flash-lite` (fast) / `gemini-3.8-flash` (balanced,
  powerful). Aman swapped the key once more mid-run; re-verified.
- **Live scorecard:** reply classification **96% (24/25)**; sequences 2/5 (3
  hung requests, see below). First run had 7 "misses" that were all free-tier
  rate limits (15/min), so the scorecard now waits on "retry in Ns".
- **Manual UI test** (Claude drove the browser): AI builder ✅, Ask AI to edit
  (Shorter) ✅, Test reply → "Wrong person" ✅, Draft with AI ✅ (via API call;
  the browser pane was hidden). Guide written in `docs/GOOGLE-STACK.md`.
- **Bugs found and fixed:** (1) Gemini `503 high demand` surfaced as a generic
  500 → fallback model `GEMINI_FALLBACK_MODEL` + clear 503 "AI is busy" from
  `AiService` (Bedrock too); (2) the Google SDK has no timeout and retries up to
  5× with 60 s waits, so calls hung for minutes → `GEMINI_TIMEOUT_MS` (45 s), SDK
  retries off, timeout triggers the fallback. Tests added (21 AI tests pass).
- Docker Desktop stopped the containers once mid-session (clean exit at
  17:20); restarted them.
- Observed, not fixed: Gemini returns each generated email as one paragraph
  (no line breaks): prompt tuning item.

**Pending for the real-AI test:** done for Phase 1. Optional: billing on for Pro
models, then `GEMINI_MODEL_POWERFUL=gemini-pro-latest`. Earlier note: fix the key's access, then
`AI_DRIVER=gemini npm run eval -w apps/api`, and try the AI builder, "Ask AI to
edit", Test reply classification and Draft with AI in the app.

---

### Conversation log, 2026-11-03 → 2026-11-12 (summary)

- **11-03, "proceed with everything that's pending":** list of 8 items (warm-up
  ramp, waitlist + feedback, reply from inbox, inbox filters, segment engagement
  rules, template/source analytics, secure-cookie sessions, shared rate
  limiting, plus smaller items: visual editor, Excel import, status manager,
  per-key API limits, bot-open filtering, chat-edit AI drafts, AI reply drafts,
  dark mode, Next 16, uptime check). All built and pushed to `main`
  (`3c8d2a7` … `bc80d24`). Found and fixed a stored-XSS risk in template
  previews on the way.
- **11-07, cloud-session handoff pasted:** "check if it follows our plan." Pulled
  the branch, re-ran everything. Verdict: matches the plan (T3.3, T1.3, T7.5,
  T2.8, T9.2 are real tasks); one out-of-plan extra (operator Pause sending),
  justified. Local test failures traced to `.env` (`EMAIL_DRIVER=` blank after
  Aman tested real Gmail), not code. Docker crashed (dockerInference stale
  socket); fixed with the documented rename recipe.
- **11-07, decision:** campaigns send **only from verified senders** (Aman picked
  "Verified only"). Built with a 15-minute retry when a Gmail grant breaks
  mid-send, and automatic verification right after a sender is added
  (`8afb3e3`). Also fixed tests that depended on a developer's `.env` and on
  shared dev-DB data (`7ee8a81`).
- **11-08, "did we pass the tests?":** first full run hung overnight (Docker
  restarted while the PC slept); re-run: **276 passed, 1 skipped**.
- **11-09, Startup Buildathon India 2026:** explained the idea-submission fields
  (problem, solution, architecture, Google AI tools, Google AI models, pitch
  deck PDF ≤ 5 MB in the organisers' template). Solo vs team must be decided
  before submitting. Batch-testing idea ("double the winning batch"): already in
  the spec (weekly top 20% doubled, bottom 20% halved), not built; with 200 leads
  use 2–3 versions, test on 30–40%, judge by replies, send the rest to the winner.
- **11-12, "can we use Gemini instead of Bedrock?" (question only):** yes, small
  change behind the existing AI socket. **Build Summary** written (vault + this
  repo). **cloud-session merged into main** with Aman's approval (fast-forward
  `bc80d24` → `8afb3e3`).

---

## Earlier history (from the vault log)

### [2026-07-18] decision | SuperSaaS taken over as A2B-owned product + V1 task breakdown
Aman's call: Yakin Shah dropping out of the SuperSaaS project; A2B takes the product forward as its
own (second owned product after ORMA). Ideas + spec work retained from the
Yakin knowledge tree; client constraints (timeline, budget,
Brilliant Directories lock-in, 8 open client decisions) dropped — decisions now A2B's.
- Created product node: SuperSaaS.
- Created full execution plan: V1 Task Breakdown
  — 11 epics (E0–E10), ~80 checkbox tasks, locked decisions (hybrid SES/Gmail/SMTP sending, BD
  integration cut, white-label readiness only, no Stripe in V1), solo Aman + Claude Code capacity
  estimates (~55–65 dev-days), acceptance criteria, cut list.
- Yakin tree kept intact as spec archive; banner added to its index. Build not started.

### [2026-07-19] update | SuperSaaS E0 executed — repo converted to monorepo, pushed
Executed E0 of V1 Task Breakdown:
- Moved `wireframebyclaude` repo → `Company/A2B AI Technologies/Products/SuperSaaS/supersaas/`
  (Obsidian ignore filter updated; wireframe knowledge node repointed).
- Converted to npm-workspaces monorepo: `apps/api` (NestJS 11, :4000), `apps/web` (Next.js 15),
  `apps/wireframe` (Phase 0 prototype preserved), `packages/shared`. Docker-compose (PG16+Redis7),
  CI (GitHub Actions), .env.example, SETUP-ACCOUNTS doc.
- Multi-agent config review → fixed: tracked launch.json untracked, api port mismatch (:3000→API_PORT
  :4000), Google Testing-mode 7-day token-expiry trap documented, scoped pkg names, lockfile committed.
- Verified: 3/3 builds green, api unit test pass, api served "Hello World!" on :4000 live.
- Pushed to GitHub `5f90adc..94e3c99` (AxZyzz/supersaaswireframe). Standing rule: push after every update.
- Remaining E0 = Aman homework: Docker Desktop, AWS+SES (2-wk lead), Google Cloud, Anthropic key.

### [2026-07-19] update | SuperSaaS E1 complete — RLS core, auth, app shell (3 pushes)
E1 of V1 Task Breakdown done in three pushed
commits (`f006e24`, `071192d`, `dcb7c36` on AxZyzz/supersaaswireframe):
- **DB core:** Drizzle + 4 migrations; RLS FORCE + fail-closed policies; restricted `supersaas_app`
  role (caught: compose superuser silently bypasses RLS — isolation tests exposed it); 5-assertion
  isolation suite green on live PG; CI runs PG service + migrations + tests.
- **Auth:** JWT access/refresh w/ rotation + reuse→family-revocation, bcrypt-12, throttling, roles
  (admin/manager/agent) guard chain, SECURITY DEFINER membership lookup, switch-org; 8-test HTTP
  integration spec.
- **Web shell:** wireframe design tokens → Tailwind v4, login/signup → dashboard live-verified
  against seeded demo user; Swagger /docs; dev seed script.
- Docker Desktop stale-socket crash mid-session; fixed by renaming `%LOCALAPPDATA%\Docker\run` (+
  secrets-engine dir) and recreating containers from compose. Fix recorded in the task breakdown.
Next: E2 lead management.

### [2026-07-22] update | SuperSaaS E2 chunk 1 — lead management core (pushed 4e2e557)
gh CLI installed (2.96.0) for CI visibility (needs one-time `gh auth login` by Aman — interactive
OAuth). E0/E1 audit fixes shipped `8442cf7` (email-enum timing hash, lower(email) index, max-w-shell
token, JWT_ACCESS_TTL, root prettier/editorconfig). Then E2 chunk 1 (`4e2e557`):
- Schema/migrations 0005–0006: leads, tags, lead_tags, lead_notes, lead_events — all org_id + RLS
  FORCE + NULLIF policies; case-insensitive partial-unique email dedupe key; app-role grants
  auto-inherited from 0002 default privileges.
- Leads module API: filtered/paginated list, CRUD (delete=admin/manager), notes, tag create/attach/
  detach, every write appends a lead_event. Web: /leads table (search/filter/paginate/quick-add) +
  /leads/[id] profile (inline status/score, notes, activity timeline).
- Live-verified in-browser end to end. Bug caught live: frontend sent snake_case, API whitelist
  wanted camelCase → fixed with a camelCase LeadInput type. 22/22 tests, lint+builds green.
- Docker crashed again mid-session (stale-socket, 4th time); recovered via rename-run-dir fix (now
  in memory reference-docker-stale-socket-fix).
Remaining E2: kanban, CSV import, dup-merge, segments, Sheets sync, REST API+keys, CSV export.

### [2026-07-22] update | SuperSaaS E2 chunk 2 — CSV import + BullMQ backbone (pushed 28e2703)
Built the BullMQ job-queue infrastructure (QueueModule, shared Redis connection) — reused by all
later background workers (AI classification, sending, analytics). First worker: CSV lead import.
- import_jobs table + RLS (migrations 0007/0008). POST /leads/import (multipart, 5MB cap, column
  mapping, duplicate policy) → enqueue; GET /leads/import/:id → status + per-row errors.
- ImportProcessor: papaparse, per-row SAVEPOINT upsert (bad row rolls back alone), case-insensitive
  email dedupe (skip/update), blank-row error capture, imported/updated lead_events.
- Web: ImportModal (client-side header parse → auto-mapping → upload → poll → result), Import CSV
  button on leads page.
- Verified live in-browser: real multipart upload → Redis → worker → 2 imported/2 skipped/1 error;
  imported leads render. 26/26 tests, lint+builds green.
Remaining E2: kanban, dup-merge, segments, Sheets sync (needs Google OAuth), REST API+keys, CSV export.

### [2026-07-22] update | SuperSaaS E2 chunk 3 — kanban + CSV export (pushed f359b7e)
- GET /leads/export streams filtered leads as CSV (papaparse unparse, 50k cap). Web: Export button
  (authed blob download), table/kanban view toggle, LeadKanban (native HTML5 DnD between status
  columns → PATCH status). 27/27 tests, live-verified (export header+3 rows; kanban 6 columns).
- Docker crashed a 5TH time mid-run (stale-socket); recovered via rename fix again. This is chronic —
  recommend a durable fix (WSL2 update / Docker reinstall / disable Docker AI features) to stop the
  recurring interruptions.
E2 remaining: dup-merge (T2.6), segments (T2.7), Sheets sync (T2.8, needs Google OAuth), REST API+keys
(T2.9). T2.3/T2.10 done; T2.1/2.2/2.4(partial)/2.5/2.11 done.

### [2026-07-22] update | SuperSaaS E2 chunk 4 — duplicate detection + merge (pushed b348674)
GET /leads/duplicates groups leads by normalized first+last+company (exact-email dups already blocked
by unique index). POST /leads/merge (admin/manager) consolidates tags/notes/events + fills primary
null fields from oldest secondary + deletes secondaries + logs 'merged' event, one tenant transaction.
Web: Duplicates modal (pick keeper per group → merge → rescan). 29/29 tests, live-verified in-browser
(2 Fox Mulders → merge → clean, 1 lead). E2 now: T2.1/2.2/2.3/2.5/2.6/2.10/2.11 done, T2.4 partial.
Remaining: T2.7 segments, T2.8 Sheets sync (Google OAuth), T2.9 REST API+keys.

### [2026-07-22] update | SuperSaaS E2 chunk 5 — segments (pushed fa07c22 backend + d175367 UI)
Segments: manual + smart (rule-based). Injection-safe rule engine (status/score/source/company/email/
tag/created predicates, all/any match), materialized membership in segment_members, cached counts.
2nd BullMQ worker (segment-refresh queue) recomputes smart membership; create/rule-change auto-enqueues.
UI: segments list, rule-builder create modal, detail w/ members + refresh. Live-verified in-browser
(smart score=hot → worker materialized 2 members, detail listed exactly the 2 hot leads). 34/34 tests.
Docker crashed a 6TH time this session (recovered via rename fix). E2 now: only T2.8 Sheets sync
(needs Google OAuth) + T2.9 REST API+keys remain. T2.9 buildable now.

### [2026-07-23] update | SuperSaaS E2 chunk 6 — public REST API + keys (pushed cce6f9e backend + 3c00d34 UI)
POST /v1/leads (X-Api-Key guard → create/case-insensitive upsert). api_keys table stores SHA-256 hash
+ display prefix; verify_api_key SECURITY DEFINER fn resolves org pre-context + stamps last_used.
Key mgmt in Settings UI (create-once raw reveal / list / revoke). 120/min throttle. 39/39 tests,
live-verified end to end (UI-generated key → real /v1/leads calls → last_used populated).
**E2 ~90% done** — only T2.8 Google Sheets sync left (needs Aman's Google OAuth). Next natural work:
E3 sender accounts (SES/Gmail/SMTP, some needs AWS+Google creds) OR close E2 by having Aman do the
Google Cloud setup so Sheets sync + Gmail sender unblock together.

### [2026-07-23] update | Docker fixed (wsl --update) + SuperSaaS E3 chunk 1 (pushed 7d4866e + 2f8935c)
DOCKER: recurring stale-socket crash (6x this session) fixed durably via `wsl --update` (2.6.1.0 →
2.7.10) + wsl --shutdown + relaunch. Data survived, 44/44 green on new kernel. Fix recorded in
reference-docker-stale-socket-fix.
E3 chunk 1: sender_accounts model + CRUD (provider ses/gmail/smtp, from name/email, reply-to, daily
limit, send window, status) + live SPF/DMARC DNS checker (node dns) with SES-aware guidance. Settings
UI: sender list/add/delete + domain-auth checker. Live-verified (google.com DNS check real; SES sender
added). 44/44 tests. Remaining E3 (SES/Gmail/SMTP provider wiring T3.2–3.5) needs AWS+Google creds.
Provider abstraction + actual sending = E5. STILL BLOCKED on Aman's account setup for real sending/AI.

### [2026-07-29] audit + build | SuperSaaS E0–E3 verified + E3 chunk 2 (pushed eaacbe0)
AUDIT (multi-agent + inline): E0–E3 checked task-by-task vs live code. **No overclaims.** E0 100%
code-side (T0.3–0.6 = Aman's AWS/Google/Anthropic homework, scaffolded). E1 100% (FORCE RLS on all 12
org tables, JWT rotation/reuse/family-revocation, role guards). E2 ~90% as claimed (segment engine
injection-safe, api keys SHA-256, import worker SAVEPOINT-per-row, merge RLS-scoped; only T2.8 Sheets
left, Google-gated). E3 was chunk-1 stub. Ground truth: 44/44 tests, 3 apps build, 15 migrations.
BUILD — E3 chunk 2 (creds-free sending spine): CryptoService (AES-256-GCM, `APP_ENCRYPTION_KEY`) →
SMTP passwords encrypted at rest, closes latent plaintext-secrets gap. `EmailProvider` abstraction
(T3.5): SmtpProvider (nodemailer real) / MockProvider (`EMAIL_DRIVER=mock`) / NotConfiguredProvider
(SES+Gmail seams) + ProviderResolver. Custom SMTP sender (T3.4): config UI, encrypted pass,
`POST /senders/:id/verify` (live conn test flips status) + `/test` (real send), admin/manager. 54/54
tests, all 3 apps build. Docker stale-socket crash recurred mid-build → fixed again (rename run/secrets
dirs + relaunch; `wsl --update` durable fix didn't hold across restart). Remaining E3: T3.2 SES + T3.3
Gmail, both creds-gated (seams ready). Next: Aman's AWS/Google setup unblocks SES/Gmail senders + Sheets
sync; then E4 campaign builder.

### [2026-07-29] build | SuperSaaS T2.4 complete — tag seeding + bulk ops (pushed 85618fa)
Finished the last partial E2 task. Default starter tags (Hot Lead/Follow Up/Customer/Partner/Cold)
seeded per workspace at signup + dev seed (idempotent). Bulk tag: POST /tags/bulk {leadIds,tagId,action}
attach/detach across many leads in one statement, RLS-scoped to the org's own leads; leads table gains
row multi-select + bulk tag bar. DELETE /tags/:id (admin/manager, lead_tags cascade). New
tags.integration.spec (seeding/bulk/tenant-scope/delete-cascade); renamed leads spec's custom tag off
the seeded names. 58/58 tests, 3 apps build+lint clean. Live-verified: fresh signup → 5 seeded tags in
bulk dropdown → select-all → Add tag → attached, shows on lead profile. **E2 now 100% creds-free; only
T2.8 Sheets left (Google-gated).** Next: E4 (templates + manual campaign builder) — creds-free, depends
E2✓ + E3 sender model✓.

### [2026-07-30] build | SuperSaaS E4 chunk 1 — templates (pushed 5841a8b)
Started E4. Template subsystem: template_folders + templates tables (migrations 0015/0016, FORCE RLS).
Render engine — {var} / {var|fallback} tokens over a whitelist (first_name, company/business_name, title,
email, phone, sender_name); unknown tokens left literal. Templates module: folder + template CRUD,
duplicate, preview (sample or real-lead data), and test-send that renders then delivers through the E3
EmailProvider abstraction (mock in dev) — SendersService.sendMessage() added + exported. 5 starter
templates seeded per workspace at signup + dev seed. Web: two-pane templates page (library + editor with
variable-insert chips + live sample preview + duplicate/delete/test-send). render unit spec + templates
integration spec (seeding/CRUD/folders/preview sample+lead/duplicate/test-send/isolation). 70/70 tests,
3 apps build+lint clean. Live-verified: fresh signup → 5 seeded templates → select Cold intro → preview
substitutes {first_name}→Alex, {business_name}→Acme Corp, {sender_name}→Jordan Lee. Docker stale-socket
crash recurred again mid-build (rename-run-dirs fix). **E4 done: T4.1, T4.3; T4.2 mostly (raw-HTML +
personalization + test-send; WYSIWYG deferred).** Next: E4 chunk 2 = campaign data model (campaigns +
campaign_steps w/ delays/conditions/A-B + campaign_leads state) — decision-heavy, pause for review before
building since E5 sending targets it.

### [2026-07-30] build | SuperSaaS E4 chunk 2 — campaign data model (pushed 43afd87)
campaigns + campaign_steps + campaign_leads (migrations 0017/0018, FORCE RLS on all 3). Steps carry
template, delay_hours, condition enum (always/opened_no_reply/not_opened), A/B subject_variants jsonb.
campaign_leads = per-lead state machine (current_step, status active/completed/stopped, stop_reason,
next_send_at). Campaigns module: CRUD + archive, step add/update/remove (auto-ordered), audience count
(segment members or all leads), enroll() materializes campaign_leads from the audience + sets next_send_at
from step-0 delay + flips campaign active (E5 advances from here). Bug caught + fixed: text params into
enum columns need explicit ::step_condition / ::campaign_status casts (was 500). Web: campaigns page —
list (status + step/lead counts), create, sequence builder, audience, enroll/archive. campaigns
integration spec (CRUD/ordered-steps/A-B/invalid-condition-400/audience/idempotent-enroll/archive-blocks/
isolation). 78/78 tests, 3 apps build+lint clean. Live-verified: create Q3 Outbound → add Cold-intro step
(A/B ×3) → enroll → status Active, 1 enrolled. **E4: T4.4/T4.7 done, T4.5/T4.6 partial (builder UI +
archive/enroll; full wizard + duplicate/schedule/pause = chunk 3).** Next: E4 chunk 3 (guided wizard +
controls) OR E5 sending engine (the state machine is ready to execute).

### [2026-07-30] build | SuperSaaS E5 chunk 1 — send engine (pushed 99d40b5)
Core sending, creds-free on the mock provider. Migrations 0019/0020/0021: sent_emails (tracking_id,
variant_index, status), email_events (sent/open/click/reply/bounce/…), suppression_list, unsub_token on
campaign_leads, and due_campaign_sends() SECURITY DEFINER scan (cross-org; app role gets EXECUTE) so the
worker finds due sends without org context then re-enters each under withOrgContext to send+record (RLS
intact). Render pipeline (T5.3): personalization + click-wrapped links + open pixel + unsubscribe footer +
List-Unsubscribe. Send worker (T5.1/5.2/5.10): tick() picks due leads, rotates senders (most-free eligible,
per-sender daily limit + send window), assigns A/B subject, enforces suppression (T5.9), sends via E3
provider OUTSIDE the DB tx, records sent_emails+email_events+lead timeline, advances the state machine
(next step delay or complete). Condition gate (T5.8 partial): always sends; conditional steps skip forward
until events exist. Repeatable BullMQ scheduler (skipped in tests / SEND_SCHEDULER=off) + POST /sending/tick.
Web: campaigns "Run due sends" button. render + send-engine specs. 81/81 tests, 3 apps build+lint clean.
Bug fixed: spec captured auth token as a string before beforeAll ran (401) → made it a function.
Live-verified: login → campaign → Run due sends → DB shows sent_email (mock msg-id), lead completed, sent
event. **E5: T5.1/5.3 done; T5.2/5.5/5.8/5.9/5.10 partial; T5.4 endpoints=chunk 2; T5.6/5.7=chunk 3 (creds).**
Docker stale-socket crash recurred again (rename-dirs fix). Next: E5 chunk 2 (open/click/unsubscribe
endpoints + events + campaign stats) — creds-free — then chunk 3 (replies/bounces) needs AWS/Google.

---

## 2026-07-31 — SuperSaaS E5 chunk 2: tracking + unsubscribe endpoints + events + campaign stats (creds-free)
Closed the tracking loop the render pipeline was already emitting URLs for. New public (`@Public`, JWT-bypass)
`TrackingController` at root paths matching send-render: `GET /t/o/:trackingId` (T5.4) returns a no-cache 1×1
gif and records an `open`; `GET /t/c/:trackingId?u=` records a `click` and 302s to the target — http(s)-only
(blocks `javascript:`/`data:` open-redirect, falls back to WEB_URL); `GET /u/:token` (T5.9) serves a styled
confirm page with NO side effects (link scanners prefetch — a GET must not unsubscribe), `POST /u/:token`
performs it (also serves RFC 8058 one-click via new `List-Unsubscribe-Post` header) → suppresses org-wide +
stops the enrollment + logs `unsubscribe`. Cross-tenant, no-org-context reads solved like the send worker:
migration 0022 adds SECURITY DEFINER `resolve_tracking()` / `resolve_unsub()` (opaque UUID tokens = bearer
caps → org_id + ids), granted only to supersaas_app; handler then records under `withOrgContext`. A click
synthesizes a missing `open` so condition gates + open stats stay consistent; lead-timeline mirrors are
first-touch only. Recording never blocks the response (UUID-guarded + try/catch → always return the asset).
Campaign stats (T5.5/T5.10): `GET /campaigns/:id/stats` — funnel (enrolled/active/completed/stopped), sent,
unique opens/clicks, unsubscribes, bounces, + per-variant A/B (sent/open/click). Web: Performance panel on
the campaign detail (metric cards + A/B table), refreshes on open/enroll/run-sends. 89/89 tests (8 new
tracking integration), 3 apps build+lint clean. Live-verified end-to-end on a real signup: pixel headers
(image/gif, no-store, 42B), click 302→target, `javascript:` rejected→WEB_URL, unsub landing → "You're
unsubscribed", DB shows open/click/sent/unsubscribe events + suppression row + lead timeline + stats JSON
(sent 1 / opened 1 / clicked 1 / unsub 1 / variant row). Note: in-app browser won't persist the SPA login
(cross-port refresh cookie rejected as cross-site) — E1 auth quirk, unrelated to chunk 2; verified via curl.
**E5: T5.1/5.3/5.4/5.5/5.9/5.10 done; T5.2/5.8 partial; T5.6/5.7 = chunk 3 (replies/bounces, needs AWS/Google).**
Next: E5 chunk 3 is creds-gated (SES→SNS bounces, reply ingestion, stop-on-reply) — so either wire creds, or
move to E6 (AI layer, Bedrock) / revisit E4 chunk 3 (guided wizard) / E2 T2.8 Sheets (Google-gated).

---

## 2026-08-01 — SuperSaaS E4 chunk 3: guided campaign wizard + duplicate/pause/resume/schedule
Finished E4. New campaign **controls** on campaigns.service + controller (admin/manager): duplicate
(`POST /campaigns/:id/duplicate` → clones campaign + steps into a fresh draft, no leads/history, name
"(copy)"); pause/resume (`/pause`, `/resume`) with allowed-from validation — the send worker only touches
`active` campaigns so pause halts delivery instantly and resume re-enters the due scan; schedule
(`/schedule {scheduledAt}`) materializes the audience now with each lead's first send pinned to the
scheduled time and marks the campaign `scheduled` (rejects past times / no-steps / archived). Migration
0023 widens `due_campaign_sends` to `status IN ('active','scheduled')`, and send.service processLead
promotes a scheduled campaign → active (sets started_at) on its first due send. Web: a **guided 4-step
wizard** (new `campaign-wizard.tsx`: Setup → Sequence → Senders → Review) that creates the draft on step 1,
builds the sequence, picks rotating senders, then finishes with **Launch now** (enroll) or **Schedule for**
a datetime; campaign detail header gains **Pause/Resume + Duplicate** buttons beside Enroll / Run due sends
/ Archive. Tests: +6 campaign-controls integration cases (duplicate shape, pause-halts/resume-sends,
resume-guard 400, schedule + scheduled→active promotion on fast-forwarded due lead, past-schedule 400) →
94/94. Also pinned jest `maxWorkers:1`: the integration specs each open a pg Pool against the one shared
Postgres and were exhausting `max_connections` when jest ran suites in parallel (27 spurious failures);
serialized run is green and reliable. 3 apps build + lint clean (exit 0). Backend live-verified via the
controls spec against real Postgres. **E4 complete (T4.1–T4.7).** Note: no fresh browser click-through this
turn — Docker Desktop hit its stale-socket crash on session teardown and would not re-init (kill+rename
run dir + `wsl --update` + relaunch all failed to bring the engine up), and the SPA login already won't
persist in the in-app browser (cross-port refresh cookie). Chose T4.5/T4.6 then E2 T2.8 (Google Sheets sync)
next — T2.8 is Google-gated; will build the creds-free scaffold and flag exactly what Google OAuth creds to
supply. Docker still down — needs to come back up before the next integration-test / live-verify run.

---

## 2026-08-02 — SuperSaaS E6 chunk 1: AI layer foundation (creds-free, Docker down)
Started E6. Built the AI backbone (T6.1) as a provider seam mirroring the E3 email pattern, so the rest of
E6 targets `AiService`, not a concrete SDK. New `apps/api/src/ai/`: `AIProvider` interface (generate →
{text, usage, model, stopReason}; fast/balanced/powerful tiers); `MockAIProvider` (`AI_DRIVER=mock`, the
default — deterministic: structured requests return schema-valid JSON built from the JSON Schema, free-form
echo the last message; no network/creds, powers dev + tests); `BedrockAIProvider` (real Claude via AWS
Bedrock — `AnthropicBedrockMantle` from `@anthropic-ai/bedrock-sdk@0.32`, model IDs `anthropic.claude-*`
env-overridable, thinking OMITTED so per-model defaults apply — adaptive on 5-series, and Haiku 4.5 would
400 on an explicit adaptive config; guarded to throw a clear error without AWS_REGION); `AIProviderResolver`
by `AI_DRIVER`. `AiService.generate(orgId, feature, opts)` = provider dispatch + retry-with-backoff on
transient errors + best-effort per-org token logging (a logging failure — e.g. the table not yet migrated —
never fails the call, so it's resilient to Docker being down). Pure prompt library (`prompts.ts`,
unit-tested): `knowledgeBlock` (KB injection, T6.2), `classifyReply` (6-class reply schema + confidence,
T6.4), `sequencePrompt` (campaign sequence schema, T6.3); untrusted reply text is confined to the user turn,
never the system prompt. Schema + migrations 0024 (`ai_usage` per-org token log + `org_knowledge` one row
per org) / 0025 (FORCE RLS, same NULLIF pattern). Wired `AiModule` into `AppModule`; `.env.example`
documents `AI_DRIVER`/model tiers. Consulted the claude-api skill first (default model now Claude Opus 5;
Bedrock uses the Mantle client). **Verification: API build + lint clean, 11/11 AI unit tests** (mock
provider, resolver, AiService orchestration incl. the usage-logging swallow) — run via `npm test -w apps/api
-- src/ai/`. **Docker was down all session** (stale-socket crash, resisted kill+rename / wsl --shutdown /
cold-launch — needs a host reboot), so integration tests + real Bedrock are deferred and migrations 0024/25
are written-but-not-applied; the AI module adds no boot-time DB/network dependency, so the integration suite
will still boot once Docker returns. Also removed the `//maxWorkers` comment key from apps/api jest config
(it triggered a jest validation warning; `maxWorkers:1` kept). **E6: T6.1 core done; T6.2/6.3/6.4 have
prompt+schema scaffolding, UIs/workers pending (need creds to demo).** Pushed `4e8e36a..c988b19`. Next when
Docker's back: apply migrations **0024/0025** (0022/0023 were already applied earlier this session), run the
full suite, then E6 chunk 2 (KB editor + AI campaign builder UI) — real Bedrock calls need AWS creds. Reboot
still required to restore Docker.

---

## 2026-08-02 (cont.) — Docker restored + SuperSaaS E6 chunk 2: Knowledge Base + AI campaign builder
**Docker recovery (post-reboot):** a plain reboot did NOT fix the stale-socket crash — DD backend kept
exiting on startup. Root cause read from `%LOCALAPPDATA%\Docker\log\host\com.docker.backend.exe.log`
(grep "backend crashed"): two locked AF_UNIX sockets, surfaced one per launch — `docker-secrets-engine\
engine.sock` (**directly under `%LOCALAPPDATA%\`, not `\Docker\`** — the old memory had the wrong parent)
then `Docker\run\dockerInference` (Docker Model Runner / "Inference manager"). Fix that worked: kill
`*docker*`/`com.docker*`/`wslrelay`/`vpnkit`/`dockerd` → `wsl --shutdown` → rename BOTH `%LOCALAPPDATA%\
Docker\run` and `%LOCALAPPDATA%\docker-secrets-engine` to `.stale-<rand>` → launch DD once → up in ~5s →
`docker start supersaas-postgres supersaas-redis`. Corrected reference-docker-stale-socket-fix with the
right paths + sequence. Applied migrations 0024/0025; **full suite 105/105** confirmed E6 chunk 1 on real
Postgres.

**E6 chunk 2 (`fc84794`):** built T6.2 (KB) + T6.3 core (generate→approve) on the chunk-1 foundation.
`AiContentService`: KB get/upsert (`org_knowledge`, `ON CONFLICT (org_id)` upsert, one row/org);
`generateSequence` (loads KB → `sequencePrompt` → `AiService.generate('sequence-gen')` → JSON-parse +
validate steps; usage logged); `campaignFromSequence` (single `withOrgContext` tx → draft campaign + one
`templates` row per step + one `campaign_steps` row referencing it, condition 'always' — reuses the E4/E5
send/render pipeline, no cross-module coupling). `AiController` (admin/manager): `GET/PUT /ai/knowledge`,
`POST /ai/generate-sequence` (200), `POST /ai/campaigns/from-sequence` (201). Web: `lib/ai.ts`,
`KnowledgeSection` (7-field editor) added to Settings, `AiBuilder` modal on the campaigns page ("AI draft"
button → brief form → Generate → editable step cards → name+segment → Create draft campaign). On the mock
provider generation returns empty steps (deterministic mock yields `[]` for the array) — the UI notes this
and lets you add steps manually, so the approve→draft flow is usable end-to-end without creds; real copy
needs AWS Bedrock creds. Tests: +4 AI integration (KB round-trip + single-row upsert; generate on mock +
ai_usage row polled; approve→draft campaign with template-per-step; empty-steps 400) → **109/109 across 22
suites**; 3 apps build+lint clean; verified on real Postgres. **E6: T6.1 core + T6.2 done; T6.3 core done
(chat-edit + real copy pending creds); T6.4 (reply classification worker) = chunk 3, needs reply ingestion
from E5 chunk 3.** Pushed `c988b19..fc84794`. Next options: E6 chunk 3 / E5 chunk 3 both need creds
(AWS/Google); creds-free remaining = E7 (unified inbox) / E8 (analytics) / E2 T2.8 Sheets (Google-gated) /
E4 WYSIWYG (T4.2). Recommend E8 analytics (creds-free, builds on existing events/stats) or E7 inbox.

---

### [2026-09-16] restructure | Vault reorg — code purge, SuperSaaS spec re-homed, drift indexed

Triggered by: "new things and projects have been added, optimize folders / reorganize for Obsidian."
Audit found the knowledge layer frozen since 2026-07-18 while code and projects piled up.

**1. Code purge (188,461 files, 23 dirs, 0 failures).** `node_modules` / `.next` / `dist` deleted from
`A2B Portal/a2b-platform`, `Products/SuperSaaS/supersaas`, and all three `VideoProjects/` repos.
Ignore filters kept these off the *graph*; they were still flooding disk and agent search
(`Company/A2B AI Technologies` was 7,019 files against ~60 real notes). **Deps must be reinstalled
before the next build session in any of those repos.** No source, git history, or env files touched.
Sweep command recorded in Graph-Hygiene.

**2. SuperSaaS spec re-homed (approved).** The product went A2B-owned on 2026-07-18 but its spec still
sat in the client tree. Moved `Yakin-shah/{What,Tech,Timeline,Finance,Assets}` →
`Products/SuperSaaS/Spec/`. 21 notes re-tagged `client/yakin-shah` → `product/supersaas` +
`origin/yakin-shah` (provenance kept per "supersede, don't erase"); `project:` frontmatter repointed to
the product brief; cross-tree links to `Admin/` rewritten absolute and labelled "(client-era)". New
Spec Index. `Yakin-shah/` Home + index rewritten
as the **client engagement record** with a was/now table. Precedent added to the client-container
pattern in Clients Index and CLAUDE.

**3. Stale status corrected.** SuperSaaS said
"planning locked, build not started" while this log recorded E0–E4 complete and 109/109 tests. Now
carries a per-epic status table (E0–E4 ✅, E5/E6 partial, E7–E10 pending, blockers named) reconciled
against the 2026-07-19→08-02 entries. Same fix in the V1 Task Breakdown header.

**4. Unindexed work surfaced.**
- New Video Production — knowledge node for `VideoProjects/`
  (added 2026-06-23, never indexed): Remotion vs Hyperframes vs Motion Canvas spike for the
  DB-reactivation explainer. **No tool chosen, no video rendered.** Motion Canvas furthest along and
  already on brand palette. Open decision: pick one, delete the other two.
- `Strategy/2026-a2b-1year-scaling-plan.md` (343 lines, written 2026-06-21, never in MEMORY) given
  standard frontmatter and declared **canonical**. Hierarchy now explicit: brainstorm → Strategy →
  Scaling (summary). Scaling's ₹-ramp table flagged **stale** — it
  banked on Yakin revenue that never arrived, and its ₹1L/mo target is **~8× off** the canonical
  $10k MRR target. **Unresolved: pick one number.**

**5. Broken references fixed.** `Company/Yakin Shah/wireframebyclaude/` was deleted at some point but
still cited in MEMORY (2 entries), Graph-Hygiene's ignore list, SuperSaaS.md, and 4 other notes. All
repointed to Wireframe App; the historical
2026-06-19 log entry left intact.

**6. Obsidian filters.** `.obsidian/app.json` → 18 filters. Added `.turbo`; converted
`.obsidian-legacy` / `.claude` / `.trash` to regex so **nested** copies are caught (plain strings only
match the vault root — `Yakin-shah/.obsidian-legacy/` and `coldcall/.claude/` were leaking); added
`package(-lock).json` and `*.zip` (the Rahul handoff `.zip` was a floating graph node — its folder was
ignored, the archive wasn't). **Reload Obsidian (`Ctrl+R`) for these to take effect.**

**Not done (deliberately):** College "stray" files (`prime.py`, `test.py`, `*_extracted.txt`,
`output.mp4`) were left in place — they are already catalogued and wikilinked in the per-subject Study
Indexes, so moving them would break 8 links for no gain. Only `package.json`/`package-lock.json`, which
those indexes themselves mark "ignore", were filtered out. Personal `Learning/`, `Media/`, `Topics/`
kept as empty-by-design capture slots (confirmed).

**Still open for Aman:** (a) $10k MRR vs ₹1L/mo — reconcile; (b) pick a video tool and delete two
repos; (c) SuperSaaS creds — AWS Bedrock + Google — unblock E5 chunk 3 / E6 T6.4, else build E7 or E8;
(d) pre-existing broken links unrelated to this reorg: `Operations/Delivery Workflow`,
`Operations/Restructure Plan — 2026`, `SuperSaaS/AWS Bedrock Setup`, `Kerala Startup Mission`,
`a2b-onboarding` — notes referenced but never written.

---

### [2026-11-01] update | SuperSaaS wireframe shared with client
Client asked for the wireframe. Extracted initial commit 5f90adc (standalone Vite prototype) to `Products/SuperSaaS/wireframe-preview/` via git archive (main repo untouched), built it, published as artifact https://claude.ai/artifact/EQzrsMPr5GVAyjzYbcVFoP (private until shared via Share menu). E8 analytics WIP left uncommitted in supersaas/.

### [2026-11-01] decision | SuperSaaS = own product, build production on existing base
No clients currently; SuperSaaS is A2B's own product. Chose option 2: continue the production build (E0–E6 base) rather than completing the wireframe; wireframe stays a visual reference only. Rebuild pieces only where the base is weak; Claude decides tweaks. Next: finish E8 analytics, then E7 inbox, E9 onboarding/pricing, creds unblock, E10.

### [2026-11-01] update | SuperSaaS E8 chunk 1 shipped (`05738fd`)
Analytics API (overview + per-campaign, sender alerts) + real Dashboard + Analytics page. 111/111 tests. node_modules had been wiped from disk — reinstalled via npm ci; Docker stale-socket fix needed again after reboot (worked first try with rename-both + wsl --shutdown).

### [2026-11-01] update | SuperSaaS E7 chunk 1 shipped (`9b68a11`)
Unified inbox + `ingestReply` seam (threading, AI classification, stop-on-reply, OOO reschedule, not-interested tag) + 3-pane UI + unread badge. Closes T5.8, T6.4, T6.5, T7.1. Real replies still need SES/Gmail creds to call ingestReply. 117/117 tests.

### [2026-11-01] update | SuperSaaS E7 chunk 2 shipped (`3459792`)
Inbox notes/assign/convert + in-app notification center (bell). Replies advance lead pipeline status. 119/119 tests.

### [2026-11-02] update | SuperSaaS production-hardening pass (`54f222e`)
Audit + fixes: env validation at boot, helmet, readiness probe, criticals cleared, CI fixed (Redis + secrets + audit gate). Partial T10.2 — authz matrix still open. Lesson: never hand-delete package-lock entries — dropping `node_modules/multer` lost its nested type-is deps and silently broke CSV uploads. 126/126 tests.

### [2026-11-02] update | SuperSaaS E9 chunk 1 shipped (`4d62a53`)
Onboarding wizard + workspace profile + org branding (runtime accent theming, logo) + dashboard start-here checklist. Closes T9.1, T9.3; T9.2 partial. Browser walk-through caught + fixed a crash on empty 200 responses (fresh-workspace knowledge base). 132/132 tests.

### [2026-11-02] update | SuperSaaS E9 chunk 2 shipped (`1638401`)
Team management: invite links (no email infra needed), accept/register page, role changes, member removal with last-admin protection. Security upgrade: JWT guard authorizes on live membership, so removal/role changes take effect immediately. 139/139 tests; invite→register walked in browser.

### [2026-11-02] update | SuperSaaS E9 chunk 3 shipped (`4fefcc8`)
Public landing + pricing (static/SEO). Beta free with V1 limits; draft paid tiers shown as indicative (one-flag toggle). No fake logos/testimonials — trust strip lists real guarantees. Closes T9.5. Also corrected `docs/SETUP-ACCOUNTS.md`: AI runs on AWS Bedrock (no Anthropic console key); remaining creds = AWS (SES/SNS/Bedrock/S3) + Google OAuth.

### [2026-11-02] update | SuperSaaS E9 chunk 4 shipped (`97aebef`) — E9 essentially done
In-app help center + contextual help, Ctrl/⌘K palette, app-wide error handling (toasts, retry states, error/404 pages), role-aware Settings. Closes T9.4, T9.6. E9 leftovers: T9.2 integrations / notification prefs / usage meter.

### [2026-11-02] update | SuperSaaS beta limits enforced + session bug fixed (`9e7d025`)
Plan limits now enforced everywhere (matches pricing page): leads 2k, 5 active campaigns, 5 steps, 3 senders, 3 seats incl. pending invites, 100/day + 1k/month emails (deferred, never dropped), 30 AI gens/month. Usage meter in Settings, dashboard alerts at 80%. `internal` plan = unlimited for A2B's own workspace. Browser testing exposed a real bug: users logged out every ~15 min due to a refresh-token race — fixed client + server. 147/147 tests.

### [2026-11-02] update | SuperSaaS E2E happy path green in CI (`1c9a171`)
Playwright test drives the real UI signup → onboarding → import → AI campaign → send → reply → inbox → dashboard; new CI job runs it on production builds. Caught 3 real bugs: AI drafts were empty on the mock provider, campaign success notes never displayed, API `start:prod` pointed at the wrong file (prod start would crash). T10.1 partial; T8.5 ticked; T0.6 re-pointed to Bedrock.

### [2026-11-02] update | SuperSaaS security + compliance passes (`9ae0b08`, `bd130a8`)
T10.2 closed: automated authorization matrix over every API route (public allow-list, 401 anon, 403 per role) + generated `docs/AUTHZ-MATRIX.md`; tightened agent permissions. Fixed local flaky tests caused by a stale Redis repeat job. T10.6 code side done: CAN-SPAM postal-address footer, GDPR export / workspace + account deletion / forget-a-lead, draft privacy + terms pages (legal review pending), `docs/COMPLIANCE.md`. 158/158 tests, E2E green.

### [2026-11-03] update | SuperSaaS operator console (`39ecf7c`)
A2B staff console: platform totals, 14-day sends, per-workspace stats + plan switch, masked failure feed, DB/Redis/queue health. Operators granted only via CLI. Also fixed: API restarts no longer bounce users to login (only 401 does). Closes T8.6 / acceptance #10. 163/163 tests.

### [2026-11-03] update | SuperSaaS live updates (`5182fb9`)
Socket.io gateway: replies, unread counts, notifications, campaign progress and team changes push live (verified in browser — reply appeared without reload). Events carry no data; clients refetch through permission-checked REST. Redis adapter for multi-instance. Acceptance criteria #8 and #10 now both met. 166/166 tests.

### [2026-11-03] update | SuperSaaS analytics reports (`a23bec9`)
Date-range analytics, per-step + subject-variant results (A/B readout), campaign CSV export, Save-as-PDF. Security fix: CSV exports now neutralise spreadsheet formulas (CSV injection). T8.4 closed. 169/169 tests.

### [2026-11-03] update | SuperSaaS creds-free backlog cleared (`7201933`, `7010154`, `9a613cd`)
Notification preferences, AI prompt versioning + eval harness, ops runbook. Found + fixed a real double-send race (overlapping send ticks emailed each lead once per tick) with a claim lease. All creds-free V1 work done; 178/178 tests, E2E green. Remaining = AWS/Google credentials + launch decisions (name/domain, hosting, beta audience).

### [2026-11-03] update | SuperSaaS pending-list pass 1 (`3c8d2a7`…`b8f0ec3`)
Warm-up ramp (T5.2), beta waitlist + invite-only sign-up + in-app feedback (T10.7), reply to a lead from the inbox (T7.3), inbox campaign/date filters (T7.4), engagement segment rules — opened / never opened / replied (T2.7), template + lead-source analytics (T8.3). 189 API tests green. Next: secure-cookie auth, Redis rate limiting, smaller items.

### [2026-11-07] update | SuperSaaS pass 2 + cloud-session review
Pass 2 on `main` (`1b40882`…`bc80d24`): Redis rate limiting, httpOnly-cookie sessions (logout now revokes), bot-open filtering, per-key API limits, AI reply drafts + chat editing, lead-status manager, Excel import, uptime probe, Next.js 16, visual email editor (+ fixed stored-XSS in template preview), dark mode. Cloud session on branch `cloud-session` (`239aba0`…`2c7bb59`, not merged): Gmail OAuth sender (T3.3, verified by Aman — mail went to spam due to localhost tracking links), password reset (T1.3), email notifications + weekly summary (T7.5), Google Sheets sync (T2.8), Settings → Integrations (T9.2), security review (7 fixes). Reviewed 2026-11-07: matches the plan; out-of-plan extras flagged (operator pause-sending).

### [2026-11-09] create | SuperSaaS Build Summary
New synthesis note Build Summary at Aman's request: full record of what's built (every commit on `main` + `cloud-session`), feature inventory, bugs fixed, security, decisions, config, and the pending list. Also: verified-only sending shipped on `cloud-session` (`8afb3e3`, Aman's decision 2026-11-08) and test isolation fix (`7ee8a81`); full suite 276/277 (1 skipped). Hub status table refreshed (was 2026-08-02).

### [2026-11-12] update | SuperSaaS cloud-session merged into main
Aman approved. `main` fast-forwarded `bc80d24` → `8afb3e3` (16 commits: Gmail OAuth sender, password reset, email notifications + weekly summary, Google Sheets sync + Integrations, security review fixes, operator pause-sending, verified-only senders, test isolation) and pushed. Pre-checks: remote unchanged, clean tree, pure fast-forward, 276/277 tests + E2E + lint + build green at `8afb3e3`. `cloud-session` branch kept.
