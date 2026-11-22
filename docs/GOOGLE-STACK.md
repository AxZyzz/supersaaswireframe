# Google stack (branch `google-stack`)

**Why this branch exists:** AWS Bedrock (Claude) is SuperSaaS's main AI path, but
there is no AWS account yet, so the AI has only ever run on the mock. This branch
adds a **Google Gemini** path so the product can be tested with real AI now, using
Google services that are already available. **Nothing is removed**: Bedrock, SES
and the mock all stay, and `main` keeps Bedrock as the default plan. Which AI runs
is one setting (`AI_DRIVER`).

Decided by Aman on 2026-11-18: "Bedrock is our main thing; for testing, a new
branch with all the Google things."

---

## Phase 1: Gemini as the AI (done on this branch)

What changed:

| File | Change |
|---|---|
| `apps/api/src/ai/providers/gemini.provider.ts` | New. Gemini adapter behind the same `AIProvider.generate()` interface as Bedrock and the mock |
| `apps/api/src/ai/providers/provider.resolver.ts` | `AI_DRIVER=gemini` selects it |
| `apps/api/src/ai/ai.module.ts`, `scripts/eval.ts` | Registered |
| `apps/api/src/ai/ai.service.ts` | Retries also on Gemini's `RESOURCE_EXHAUSTED` / `UNAVAILABLE` errors |
| `apps/api/src/config/env.validation.ts` | Boot fails with a clear message if Gemini is selected without a key/project |
| `.env.example`, `docs/SETUP-ACCOUNTS.md`, `docs/COMPLIANCE.md` | Settings and notes |
| Tests | `gemini.provider.spec.ts` (request/response mapping, tiers, errors), resolver + env tests |

Every AI feature uses it with no other change: AI campaign builder, "Ask AI to
edit", reply classification, AI reply drafts, and the eval scorecard. The prompts
are the same ones Claude uses.

### How the adapter works (plain terms)
- Our "assistant" messages become Gemini's "model" role; the system prompt becomes
  Gemini's system instruction.
- Structured answers (JSON) use Gemini's JSON mode with **the same JSON Schema**
  the Claude path uses.
- Gemini 2.5+/3.x Flash and Pro models "think" before answering and those tokens count toward the
  output cap, so the adapter adds headroom (`+8192` tokens) to avoid JSON cut off
  mid-answer. You pay only for tokens actually used.
- Token usage (including thinking tokens, which are billed as output) is logged
  to `ai_usage` like every other provider, so usage meters and quotas still work.
- An empty answer (safety block, token cap) becomes a clear error with Google's
  reason instead of a silent blank.

### Models per tier
| Tier | Used for | Default model | Override |
|---|---|---|---|
| fast | reply classification | `gemini-3.5-flash-lite` | `GEMINI_MODEL_FAST` |
| balanced | reply drafts, edits | `gemini-3.5-flash-lite` (fast; since 2026-11-19) | `GEMINI_MODEL_BALANCED` |
| powerful | campaign builder | `gemini-3.5-flash-lite` (since 2026-11-19; Pro once billing is on) | `GEMINI_MODEL_POWERFUL` |

Live-checked 2026-11-18 with a new AI Studio key: Gemini 2.5 models are closed to
new users (`404 ... no longer available to new users`), and Pro models
(`gemini-pro-latest`, `gemini-3.1-pro-preview`) return "exceeded your current
quota" on the free tier. With billing on, set
`GEMINI_MODEL_POWERFUL=gemini-pro-latest`. Google renames and retires models
often; re-check the list in AI Studio if a call starts failing with 404.

---

## Turning it on (you do this; Claude never creates accounts or handles keys)

**Option A — Gemini API key (fastest):**
1. Go to Google AI Studio (aistudio.google.com) with the A2B Google account.
2. Create an API key (it can sit in the same Google Cloud project as the
   Gmail/Sheets OAuth client).
3. In `supersaas/.env` (never in chat, never committed):
   ```
   AI_DRIVER=gemini
   GEMINI_API_KEY=<your key>
   ```
4. Restart the API.

**Option B — Vertex AI (stronger data terms, fits Google Cloud hosting later):**
1. Enable the Vertex AI API in the Google Cloud project, with billing on.
2. Run `gcloud auth application-default login` on this machine.
3. In `.env`:
   ```
   AI_DRIVER=gemini
   GEMINI_USE_VERTEX=true
   GOOGLE_CLOUD_PROJECT=<project id>
   GOOGLE_CLOUD_LOCATION=us-central1
   ```

**Data:** Google may use inputs on the Gemini API *free* tier to improve its
products. Fine for testing with demo data; use a **paid** key or Vertex AI before
real customer replies go through it.

**Back to Bedrock or mock:** set `AI_DRIVER=bedrock` or `AI_DRIVER=mock`.

---

## Testing with real AI

1. **Scorecard** (25 labelled replies + 5 campaign briefs, same set Claude will be
   judged on):
   ```bash
   AI_DRIVER=gemini npm run eval -w apps/api
   ```
   Prints classification accuracy per reply type, sequence checks, tokens used,
   and saves a JSON report under `apps/api/evals-results/`.
2. **In the app:** see "Manual UI test" below.
3. Automated tests never call Gemini: Jest forces the mock (`test/setup-env.ts`).

### Results so far (2026-11-18, free-tier key)
| Check | Result |
|---|---|
| Scorecard: reply classification | **96% (24/25)**: interested 6/6, question 5/5, not interested 6/6, out of office 3/3, wrong person 3/3, needs review 1/2 (one ambiguous reply called "question") |
| Scorecard: campaign sequences | 2/5 passed; the other 3 were `fetch failed` (requests hanging on an overloaded model, before the timeout fix below), not bad output |
| UI: AI campaign builder | ✅ 3 on-brief emails, tokens kept, delays 0/72/96h, ~50 s. Each email came back as one paragraph (no line breaks): prompt tuning item |
| UI: "Ask AI to edit" → Shorter | ✅ 65 → 51 words, tokens kept, Undo works (answered by the fallback model) |
| UI: Test reply classification | ✅ "not the right person, talk to Priya" → **Wrong person** |
| UI/API: Draft with AI | ✅ "Hi Maya, thanks for pointing me in the right direction. I will reach out to Priya directly." in 5 s |

### Reliability fixes found while testing
- Google's `503 high demand` on `gemini-3.8-flash` turned into a generic 500. Now:
  one retry on `GEMINI_FALLBACK_MODEL` (default `gemini-3.5-flash-lite`), and if
  the provider is still busy after retries, a clear **503 "The AI service is busy
  right now"** (applies to Bedrock too).
- The SDK has **no request timeout** and **retries 503/429 itself up to 5 times
  with up to 60 s waits**, so one call could hang for minutes (the hanging reply
  draft, the scorecard's `fetch failed`). Now each Gemini call is capped at
  `GEMINI_TIMEOUT_MS` (default 45 s), SDK retries are off, `AiService` owns
  retries, and a timeout also switches to the fallback model.
- The scorecard waits and retries when Google says "retry in Ns" (free tier:
  15 requests/minute per model), so quota pauses no longer count as wrong answers.

---

## Manual UI test (step by step)

**Before you start**
1. Docker Desktop running, then `docker start supersaas-postgres supersaas-redis`.
2. `supersaas/.env` has `AI_DRIVER=gemini` and your `GEMINI_API_KEY`.
3. Terminal 1: `npm run start:dev -w apps/api` (wait for "Nest application successfully started").
4. Terminal 2: `npm run dev -w apps/web`, then open http://localhost:3000.
5. Log in (local demo account from `npm run db:seed -w apps/api`, or your own).

**How to tell it's really Gemini:** mock answers are canned (e.g. subject
"Quick idea for {company|your team}" every time, drafts starting "Thanks for
getting back to me!"). Gemini's text follows your brief and changes every run.
The `ai_usage` table records provider `gemini` and the exact model per call.

**Test A — AI campaign builder (powerful tier)**
1. Campaigns → **AI draft**.
2. Goal: "Book 15-minute demo calls for our AI cold-email platform". Audience:
   "Founders of small B2B marketing agencies in India". Tone: "Friendly, direct".
   Emails: 3.
3. **Generate**. Takes 20–60 s on the free tier.
4. Check: subjects and bodies match the brief; `{first_name|there}` style tokens
   are present; step 1 delay 0 h, later steps spaced out.
5. Optional: **Create draft campaign** to save it.

**Test B — "Ask AI to edit" (balanced tier)**
1. In the builder, under any email, click a chip (**Shorter**, **More casual**,
   **More direct**, **Stronger call to action**) or type your own instruction
   ("mention we give a free deliverability audit") and press **Apply**.
2. The email is rewritten in place; tokens survive. **Undo** (↶) restores it.

**Test C — Reply classification (fast tier)**
1. Inbox → **Test reply** (top of the list).
2. Lead email: an existing lead's email. Paste a reply and **Inject reply**.
3. The conversation shows a badge with Gemini's class. Try these:
   - "Sounds good, can we talk Thursday at 3?" → **Interested**
   - "How much does it cost for a team of 5?" → **Question**
   - "Not interested, please remove me." → **Not interested**
   - "I'm out of office until the 25th, limited email access." → **Out of office**
   - "I don't handle this, talk to Priya in growth." → **Wrong person**
4. Not-interested stops the lead's sequence and tags them; out-of-office pushes
   the next email 3 days; others stop the sequence (reply received).

**Test D — Draft with AI (balanced tier)**
1. Open a conversation → in the composer click **Draft with AI**.
2. Or type notes first ("offer Thursday 3pm, mention free audit") and click
   **Rewrite with AI**: your notes steer the draft.
3. Review and edit the draft. ⚠️ **Send reply really sends email** through the
   conversation's sender (with `EMAIL_DRIVER` blank, through your real Gmail /
   SMTP). For a pure AI test, stop at the draft.

**Test E — Knowledge base effect**
Settings → Business knowledge: fill in your offer and proof points, save, then
repeat Test A. The emails should now use those facts.

**If something fails**
- "The AI service is busy right now" → free-tier rate limit or Google overload;
  wait a minute and retry.
- Want stronger writing? Every tier defaults to the fast Flash-Lite model. Set
  `GEMINI_MODEL_POWERFUL` (campaign builder) or `GEMINI_MODEL_BALANCED` (drafts,
  edits) to a bigger model and restart the API; Flash-Lite still covers it when
  that model is busy.
- Back to the mock or Bedrock: `AI_DRIVER=mock` / `AI_DRIVER=bedrock`, restart API.

---

## Gmail reply reading (Phase 2, built 2026-11-19)

**What it does:** every 2 minutes (and on **Inbox → Sync Gmail**) the API reads
new messages in the inbox of each connected Gmail sender that allowed reading:

| Message | What happens |
|---|---|
| Reply from someone you've emailed from SuperSaaS | Goes into the Inbox through the normal reply path: quoted older text stripped, AI-classified, sequence stopped (or rescheduled for out-of-office), notifications, dashboard reply count |
| Bounce from `mailer-daemon` / `postmaster` for an address you emailed | Address suppressed (reason `bounced`), its active sequences stopped, bounce event + lead timeline entry |
| Anything else (your personal mail) | Ignored. Never stored: only its Gmail id is kept so it isn't fetched again |

**Turning it on (once per Gmail sender):**
1. Settings → Senders: a Gmail sender shows **Replies: off — reconnect to read
   replies**. Click it (or **Connect Gmail** again with the same account).
2. On Google's screen, leave **"Read your email messages and settings"** ticked
   (new permission, `gmail.readonly`) next to "Send email on your behalf".
3. Back in Settings the sender shows **Replies: waiting for first sync**, then
   **Replies: synced N min ago**.

**Google Cloud note:** `gmail.readonly` is a **restricted** scope. While the
OAuth app is in **Testing** mode it works for the accounts listed as test users
(add the Gmail addresses you'll connect in Google Cloud Console → APIs & Services
→ OAuth consent screen → Test users; also add the scope under Data access if
Google asks). Testing-mode tokens expire after 7 days (reconnect). Public launch
needs Google's verification incl. a security assessment.

**Details:** first sync looks back 3 days; each sync overlaps the previous one by
15 minutes; at most 200 messages per sync; a revoked/expired token marks the
sender for reconnect and shows the error in Settings. Code:
`apps/api/src/inbox/gmail-reply-sync.service.ts`; migration `0045`; tests
`gmail-reply-sync.integration.spec.ts`.

**Not covered yet:** opens/clicks still need a public `API_URL` (tunnel or
hosting); SMTP and SES senders have no reply reading (Gmail only).

---

## Model router (Learning Loop T08)

**What it does, in plain words:** every AI call now says what it is for (a *task*, e.g. `reply_classify`,
`campaign_build`). The router looks the task up, picks the model for it, skips a model that is currently
failing, falls back to another one, keeps one workspace from burning the whole AI budget, and writes one
log line saying *why* it picked what it picked. The default result is the same as before: with no
settings changed, every task still runs on the same models.

| Task | Default tier | Output screened by Model Armor |
|---|---|---|
| `reply_classify` | fast | no |
| `reply_draft`, `template_edit` | balanced | yes |
| `campaign_build`, `challenger_draft` | powerful | yes |
| `discover_plan`, `review_explain` | balanced | review_explain yes |
| `discover_verify_extract`, `import_column_match` | fast | no |

(`ai_usage.feature` keeps its old names, e.g. `sequence-gen`, because plan limits count them. The card
translates them to tasks.) Code: `apps/api/src/ai/router/` (`tasks.ts`, `policy.ts`, `circuit-breaker.ts`,
`budget.ts`, `model-router.ts`).

**Rules**
- **Models per tier:** the same env vars as before (`GEMINI_MODEL_FAST|BALANCED|POWERFUL`, then
  `GEMINI_FALLBACK_MODEL`). The router owns fallback now (it tries the tier model, then the fallback).
- **Circuit breaker:** 3 failures (timeout, 429, 503) on one model within 2 minutes -> that model is skipped
  for 5 minutes. State is in Redis (`ai:cb:<model>` open flag, `ai:cbf:<model>` failure count), so all Cloud
  Run instances agree. Redis cost: one INCR (+ one EXPIRE on the first failure, + one SET when it trips) per
  failure, and about one EXISTS per model per 15 s per instance (the answer is cached in memory for 15 s).
  If Redis is down the breaker simply does nothing.
- **Budget:** `AI_DAILY_TOKEN_CAP_PER_ORG` (default 2,000,000 tokens a day per workspace, `0` = no cap).
  Over the cap -> `powerful` runs on the `balanced` model and `balanced` on the `fast` model. Over twice the
  cap -> a clear 429 "AI daily limit reached" for everything except reply classification, which never blocks.
  Usage comes from `ai_usage`, cached 60 s.
- **Decision log:** one JSON line per call, which Cloud Logging indexes:
  `{"event":"ai_route","task":"campaign_build","chosen_model":"...","reason":"policy|fallback_timeout|circuit_open|budget_downgrade","attempt":1,"latency_ms":820,"tokens":1530}`.
  Failed attempts log the same line with `"error":true`. A tripped circuit logs `{"event":"ai_circuit_open","model":"..."}`.

**Reading the "AI routing" card** (Operator console, `/operator`, A2B staff only): the table shows, for the
last 24 hours, each task -> model with calls and tokens (from `ai_usage`, all instances). Under it, fallbacks,
circuit skips, budget downgrades and circuit-open events come from an in-memory ring of the last 500 calls
on the **one API instance you reached**, so on Cloud Run with several instances they are a sample. For the
full picture use Cloud Logging: filter `jsonPayload.event="ai_route"`.

## Model Armor (Learning Loop T08)

**What it does, in plain words:** web pages Discover reads and replies from strangers are text we do not
control, and either could say "ignore your instructions and ...". Google Cloud **Model Armor** checks that
text *before* an AI sees it, and checks AI text again before a person sees or sends it.

| Where | What happens when Model Armor says "blocked" |
|---|---|
| Discover, each fetched page (chunked, only what we send is screened) | The page is dropped from the evidence. The company shows "1 page skipped by safety check". If every page is dropped the company is left "unverified". |
| Inbound reply, before AI classification | The reply becomes **Needs review**, the AI never reads it, no AI draft is offered (button disabled, server refuses), and the inbox shows "Safety check flagged this message". Flagged (e.g. a card number in the reply) behaves the same. |
| AI output (reply drafts, template edits, campaign builder, challenger drafts, review explanations) | The text is withheld: the user sees "AI output withheld by safety check" (HTTP 422) and a line is logged. |

**Turn it on** (off by default; nothing changes until you do): create the template once
(`infra/model-armor/README.md`, **needs Aman's go**), then set
`SAFETY_DRIVER=modelarmor`, `MODEL_ARMOR_TEMPLATE=expelly-safety`, `MODEL_ARMOR_LOCATION=us-central1`,
`GOOGLE_CLOUD_PROJECT=<id>`, and give the service account `roles/modelarmor.user`.
`SAFETY_FAIL_MODE=open` (default: if Model Armor is down, log an `ERROR` line and carry on, availability
first) or `closed` (refuse: replies go to manual review, pages are skipped, AI output returns a 503).
The app refuses to boot with `SAFETY_DRIVER=modelarmor` and no template.

**Cost:** free for the first 2 million tokens a month, then $0.10 per million tokens (checked 2026-11-21 on
Google's pricing page). Beta volume costs cents. Region `us-central1` (Mumbai has limited filter support).

**Proof line** (what a blocked page logs): `{"severity":"WARNING","event":"safety_screen","direction":"input","context":"web_page","verdict":"blocked","findings":["pi_and_jailbreak"],"provider":"modelarmor"}`.
Code: `apps/api/src/ai/safety/`. Tests never call Google: they use a fake client.

---

## ADK agents over A2A (Learning Loop T09)

**What it does, in plain words:** two small Python AI "agents" (`apps/agents`, built with Google's
Agent Development Kit) help the Review. The **Review analyst** explains a campaign review in plain
English, and every sentence cites the finding ids it relies on. The **Copywriter** drafts three
challenger subject lines. The API talks to them over the **A2A protocol** and treats them as
untrusted: it re-checks every finding id, number and "winner"-style word in the explanation, and if
anything fails it shows the built-in template text and stores why (`explanation_source='template'`,
`explanation.fallbackReason`). The decision itself is still made by code; nobody applies anything
without a person approving it. Neither agent ever receives lead data.

**Switches** (all default off; nothing changes until you set them):
`REVIEW_EXPLAINER=template|agent|gemini`, `COPYWRITER_DRIVER=gemini|agent|mock`,
`REVIEW_ANALYST_URL`, `COPYWRITER_URL`, `A2A_AUTH`, `A2A_CARD_PATH` (see `.env.example`).
`gemini` mode is the same instruction as a direct Gemini call (no agent server needed); `mock`
returns fixed template subjects.

**Where the pieces are:** contracts (JSON Schemas + shared test fixtures) in
`packages/shared/src/agents/`; the API side in `apps/api/src/agents/` (A2A client with 30 s timeout,
one retry and the T08 circuit breaker, the explanation validator, the Copywriter drafter that plugs
into T11's `CHALLENGER_DRAFTER`); the agents in `apps/agents/`. The Review card shows "Explained by
Expelly Review agent" with each point linked to its number (hover highlights it). One log line per
agent call carries a `trace_id`, the same W3C trace id sent to the agent, for Cloud Trace.

**Run and deploy:** `apps/agents/README.md` (local) and `apps/agents/deploy/README.md` (Agent Engine:
region, cost, service account, Agent Registry; not run yet). Try it locally with
`npm run try:agents -w apps/api`.

---

## Later phases

| Phase | What | Notes |
|---|---|---|
| 2 | ✅ **Built 2026-11-19** (see "Gmail reply reading" below). Read replies via the Gmail API (polling every 2 min) and **detect bounces** from "undeliverable" messages | Needs a Gmail *read* scope, which Google classes as **restricted**: building and testing in testing mode is fine, but public launch needs Google's app verification including a third-party security assessment (weeks, can cost money) |
| 3 | Hosting on Google Cloud: Cloud Run (API + workers), Cloud SQL (Postgres), Memorystore (Redis), Cloud Storage (instead of S3), budgets, Secret Manager | Tied to hosting decision D-C |

**Sending:** Google has no bulk-sending service like SES. On Google, campaigns go
out through Gmail / Google Workspace mailboxes (already built and verified) or
SMTP. A Workspace mailbox allows roughly 2,000 sends a day, far above the warm-up
caps (20–100/day per mailbox) cold email should use anyway. Platform emails
(password reset, notifications) can use Google Workspace's SMTP relay via
`SYSTEM_SMTP_*`.


---

## Discover as an ADK agent (T10; code done, not deployed)

`DISCOVER_DRIVER=agent` sends each Discover search to the Python Discover agent (`apps/agents/expelly_agents/discover/`)
over A2A with a typed request (`packages/shared/src/agents/discover.*.schema.json`: goal, offer, mode `baseline|targeted`,
an optional search preference, companies to skip). The agent plans, proposes companies and, per company (4 at a time),
reads the site through ONE tool: `POST /internal/agent-tools/fetch-pages` on the API, which does the SSRF guard, robots.txt,
page limits and Model Armor, and answers only to the agent's service account (`AGENT_TOOLS_SA_EMAIL`, ID token for
`AGENT_TOOLS_AUDIENCE`, at most 60 companies per run). Its answer is a claim: the API checks every quote against the same
pages (Redis cache), reads emails from the pages, scores, dedupes, caps and stores, and decides `matchedPreference` itself.
`native` (default) is today's pipeline, unchanged, and also the fallback when the agent cannot answer.
Deploy steps (Agent Engine, the two settings): `apps/agents/deploy/README.md`. Not run.

---

## Scheduled jobs, monitoring and tracing (T13; live since 2026-11-21, see infra/ READMEs)

The loop's time-based jobs (weekly review, preference expiry, loop-health log line) can run from **Cloud Scheduler**
calling `/internal/cron/*` with a Google-signed token (`CRON_MODE=scheduler`, `CRON_AUDIENCE`, `CRON_SA_EMAIL`); the default
`CRON_MODE=internal` keeps the API's own timers. **Cloud Monitoring** log-based metrics and four alert policies read the
`loop_health`, `ai_circuit_open` and `weekly_review_failed` log lines. **Cloud Trace** is on with `TRACING=on` (the runtime
service account needs `roles/cloudtrace.agent`); the A2A calls carry the live trace context. Commands and policy files:
`infra/scheduler/README.md`, `infra/monitoring/README.md`. None of it has been run: it waits for the T08, T09, T10 and T13 deploy.

---

## Phase 4: BigQuery learning plane (T07)

**What it is.** A read-only copy of the analytics tables in BigQuery, kept about 15 minutes behind Postgres by
**Datastream**. The Insights page can read it (`INSIGHTS_SOURCE=bigquery`) and the search-policy comparison and
dashboards (T16) sit on it. Postgres stays the source of truth: A/B decisions, approvals and search preferences
never read BigQuery.

```
Cloud SQL ──Datastream──► BigQuery expelly_raw (locked) ──views──► expelly_learning ──► API (INSIGHTS_SOURCE=bigquery)
```

**What flows.** Only the tables and columns in `infra/bigquery/replication-set.json`
(campaigns, steps, enrollments with their frozen snapshot, sent emails, email events, outcome events, experiments,
variants, assignments, reviews, review actions, search preferences, Discover runs and prospects, plus offers,
templates and the workspace timezone). Datastream creates one table per source table in `expelly_raw`
(`public_<table>`); `infra/bigquery/views/*.sql` builds `company_reach`, `factor_funnel`, `send_time_grid`,
`discovery_funnel`, `search_policy_compare`, `review_history` and `data_freshness` in `expelly_learning`, each
with a description on the view and every column.

**What is excluded, and why.** No email addresses (`sent_emails.to_email`, `prospects.emails`), no rendered
subject lines (they can hold a recipient's name), no message text, no lead names or titles, no evidence quotes
column, no free-text notes, no reason or explanation text, no idempotency keys or secrets. This is enforced three
ways: the Postgres reader role has `SELECT` on listed columns only, the publication and the Datastream include
list name the same columns, and a Jest test fails the build if a PII-looking column is added.
Honest limits: JSON columns (`campaign_leads.snapshot`, `prospects.triggers`) can hold the website evidence quote of a
buying trigger and free-mail company keys are email addresses; Datastream cannot trim inside JSON. So `expelly_raw`
is locked (only Datastream writes it, only the `expelly_learning` views read it, the API's service account cannot read it)
and the views expose only whitelisted keys and hash free-mail keys.

**How the API uses it.** `BigQueryInsightsSource` reads the `company_reach` view with parameterised queries that
always filter `org_id = @org_id` (a unit test fails if any SQL string in the file lacks it), a 1 GiB cap per query,
and feeds the same mapping and aggregation code as the Postgres source, so the two sources keep the same contract.
The Discover funnel's "eligible" count and the sender labels still come from Postgres (they need data we do not
copy). If BigQuery fails the page answers from Postgres and logs a warning. The page shows "Data as of <time>".

**Not identical to Postgres mode:** `subject_length` is measured on the template text; old enrollments with no
snapshot show "unknown" for lead-level factors.

**Cost.** Datastream bills per GB processed (cents to a few dollars a month at our volume; the backfill is one-time).
BigQuery is inside the free tier. **Turn on:** `INSIGHTS_SOURCE=bigquery`. **Turn off:** `INSIGHTS_SOURCE=postgres`
(default). Pause copying: `gcloud datastream streams update expelly-learning-stream --location=asia-south1 --state=PAUSED`.
**Plan B** if Datastream is blocked: a BigQuery connection plus federated `EXTERNAL_QUERY` views with the same view names.

Setup steps, commands and the exact state: `infra/bigquery/README.md`.

---

## Phase 5: Playbook memory (T14; dataset, table, Vertex and the real smoke run, migration `0060` and deploy (API 00022, web 00013) and the switch (API 00023, `PLAYBOOK_SEARCH=bigquery`) done 2026-11-22)

**What it is.** A **playbook** is a lesson a person approved: "a short question as the subject beat a plain greeting for
this offer" (kind `message`), or "Pune replied more for this offer" (kind `audience`). It is saved with the offer, the
segment, plain-words text (3 to 500 characters), the evidence it came from, a validity window (default 90 days, max 1
year) and a version. Editing saves a **new version**; the old one stays in the history (`supersedes_id`, status
`superseded`). Retiring keeps the row (status `retired`). Postgres (`playbooks`, RLS on `org_id`, migration `0060`) is the
source of truth.

**How one is made.** Review > pause the losing version of a promoted test (or Discover > Search profile) shows
**Save as playbook**. Code writes the draft from the review's own numbers (`playbook-drafter.ts`); the model may reword it
(`playbook_draft` task, fast tier, 8 s, Model Armor on) but the wording is kept only if every number in it is one the
evidence supports and an audience draft claims no proof or cause. Otherwise the template stays. The evidence under the form is
read-only: the server rebuilds it from the review, so a client cannot invent it. A person edits and saves. Nothing is saved
without that. Needs a `promote` decision whose losing version was paused (and not simulated), or an active or expired search preference.

**How it is found.** Each playbook's `title + body + segment` is embedded with **`gemini-embedding-001`** (768 dimensions,
`RETRIEVAL_DOCUMENT`); a Discover goal or a challenger request is embedded as `RETRIEVAL_QUERY`. Vectors live in BigQuery
`expelly_memory.playbook_vectors` (DDL: `infra/bigquery/playbooks.sql`) as ids + the offer + the expiry + the vector, **no title, no
body, no lead data**. Retrieval is `VECTOR_SEARCH` (cosine, exact) over the rows where `org_id = @org_id AND offer_id =
@offer_id AND valid_to > now`, top 3. The API then **re-checks every hit in Postgres** (same org, same offer, still active, not
expired) before using it, so a stale vector can never leak a retired or expired playbook.

```
Save ─► Postgres playbooks (text, evidence, versions) ─► embed (Vertex) ─► BigQuery expelly_memory.playbook_vectors (ids + numbers)
Draft / Discover ─► embed the question ─► VECTOR_SEARCH (org, offer, unexpired, top 3) ─► re-check in Postgres ─► hints in the prompt
```

**Use.** The Copywriter request (T09) and the Discover plan request (T10) get `playbooks: [{title, body, validTo}]` (at most 5;
the shared JSON schema and the Python models agree). The prompt says: "Prior approved learnings ... Treat them as hints, not
facts. Prefer the current evidence." The AI never sees lead data (playbooks hold none). The UI shows **Used N playbooks** on a
challenger draft and on a Discover run, linked to the playbook; the run and the draft store which playbooks they used
(`playbook_ids`). `/review/playbooks` lists playbooks by offer with status, validity, version history, retire, edit, and a link back
to the evidence review.

**Switches.**

| Setting | Values | Meaning |
|---|---|---|
| `PLAYBOOK_SEARCH` | `postgres` (default) / `bigquery` | `postgres` = keyword search only (no vectors written). `bigquery` = vectors + `VECTOR_SEARCH`, keyword fallback if anything fails. |
| `EMBEDDING_DRIVER` | `gemini` (default when `AI_DRIVER=gemini`) / `mock` | Jest always uses `mock`. |
| `EMBEDDINGS_USE_VERTEX` | `true` | Embeddings on Vertex AI with the runtime service account (needs `roles/aiplatform.user`); otherwise `GEMINI_API_KEY`. |
| `EMBEDDINGS_LOCATION` | default `us-central1` | Vertex may not offer the embedding model in `asia-south1`, so embeddings are called in `us-central1` while the data stays in `asia-south1`. Only playbook text and the search goal text are sent (no lead data). |
| `BIGQUERY_MEMORY_DATASET` | default `expelly_memory` | The vector dataset. |

Saving never fails because the vector store is down: the playbook is saved, its `vector_status` shows `pending` or `failed`, and an
admin can press **Rebuild search index** (`POST /playbooks/reindex`). Keyword search finds it meanwhile.

**Why BigQuery and not Agent Engine Memory Bank (the task asked for the reason).** Memory Bank needs a deployed Agent Engine, and
the Expelly agents are code-only so far (`apps/agents/deploy/README.md` not run), so choosing it would make this task wait for, and
depend on, a billed service that is not there. More important, Memory Bank is built around memories an agent *derives from
conversations*, keyed by a scope. We need the opposite: text a person wrote and approved, hard filters (workspace, offer, expiry),
versions, and evidence. In BigQuery the workspace wall is a `WHERE` clause that tests check on every statement, and Postgres re-checks
the result. BigQuery is also already in the stack (T07), the table is tiny and testable with a fake client.
Revisit Memory Bank if the agents are ever deployed and we want agent-written memories.

**Dataset choice.** The task note said `expelly_learning.playbook_vectors`. That dataset holds only authorised views over the locked
copy and the API's service account only reads it, so the writable vector table is in its own dataset `expelly_memory`, with its
own grant. Playbooks are **not** replicated to `expelly_raw` (`replication-set.json` is unchanged), so their text never reaches BigQuery.

**Cost.** Embeddings: a few hundred short texts, cents a month. BigQuery: a table of a few hundred rows; a search scans kilobytes
(the 1 GiB per-job cap still applies); well inside the free tier. No vector index until past about 5,000 rows.

**Real smoke run (passed 2026-11-22, 4 of 4 checks, image `api:t14-b78aa93`).** `npm run playbooks:smoke -w apps/api` (also as `node dist/scripts/playbook-smoke.js` in a Cloud Run job) writes five
throwaway vectors under two made-up workspaces and offers, searches, checks that only workspace A's unexpired playbooks of
that offer come back (an expired one, another offer and another workspace all carry the same text), checks a removed one disappears, then
deletes its rows. It touches no real workspace and no Postgres.

**Turn on / off.** On: create the dataset and table (`infra/bigquery/playbooks.sql`), give the API's service account write access to
`expelly_memory` and `roles/aiplatform.user`, set `EMBEDDINGS_USE_VERTEX=true` and `PLAYBOOK_SEARCH=bigquery`, run **Rebuild search
index** once. Off: `PLAYBOOK_SEARCH=postgres`.


## Phase 6: Google Calendar booked calls and the Looker Studio dashboard (T16; code merged, Calendar API on, migration `0061` and deploy (API 00024, web 00014) done 2026-11-23; the dashboard views, consent-screen steps and a real test booking still to do)

Two small, independent pieces. Part A turns a meeting with a lead into a verified "booked call" automatically. Part B is a shareable
Looker Studio dashboard on the T07 BigQuery views.

### Part A: booked calls verified from Google Calendar

**What it does.** A manager or admin can connect a Google Calendar (Settings > Integrations > Connect Google Calendar). Every 15 minutes
the API reads the events that changed on that calendar. When an attendee is a lead we emailed (a delivered email, sent before the event was
created and not longer ago than the response window), it records a `booked_call` outcome with source `calendar`, verification `verified`,
linked to the enrollment, experiment and variant of that email. If the event is later cancelled, a superseding `rejected` row is added.
Nobody has to click "Booked a call". Code decides; no AI is involved.

**What it reads, and what it never does.**
- Scope: `https://www.googleapis.com/auth/calendar.events.readonly` (view events on all calendars; no editing). It is a separate, optional
  connect: the Gmail and Sheets connect screens never ask for it.
- The request asks Google only for event id, status, created time, start and the attendee email addresses (a fields mask).
  **Titles, descriptions, locations and organisers are never requested and never stored.** The outcome row keeps the event id (inside the
  idempotency key), the start time (as the time of the outcome) and the matched lead.
- Only the connected account's primary calendar is read. Declined attendees, the account itself and room resources are ignored.

**How a match is decided** (`apps/api/src/integrations/calendar-logic.ts`, pure and tested):
1. Attendee emails are lower-cased and looked up among the workspace's leads (row-level security, so another workspace's lead can never match).
2. A lead matches when a delivered email to them (`sent_emails.status = 'sent'`) was sent before the event was created, and the event was
   created no later than the response window afterwards: the experiment's `response_window_days`, default 14.
3. Several matching emails: the most recent one is used (it carries the enrollment, experiment and variant).
4. No match: nothing is recorded. It never guesses.
5. Idempotency key `cal:<calendar account email>:<event id>`: a repeat sync, or a rescheduled event, never adds a second outcome. A cancel is
   found by that key (Google sends a cancelled event without attendees) and adds `calcancel:<account>:<event id>`.

**How it runs.** `CalendarSyncService.runDue()` is a tick (every 15 minutes, in-process like the Sheets and Gmail syncs; the API is always on).
A SECURITY DEFINER function `due_calendar_syncs()` (migration `0061`, same pattern as `due_sheet_syncs`) is its one cross-workspace read.
The first sync reads yesterday to 30 days ahead; later syncs read only what changed since the last good sync (5 minutes of overlap) with
deleted events included. A failed sync keeps its cursor and shows the problem on the Settings card; a revoked or expired token
(`invalid_grant` or HTTP 401) sets "Reconnect needed" and the job leaves that workspace alone until it is reconnected.

**Changes.**
- Migration `0061_google_calendar` (additive): `integrations.provider` may now also be `google_calendar`, plus `due_calendar_syncs()`.
  No new table: the encrypted refresh token and the sync cursor live in `integrations.config`, like Sheets.
- `OutcomesService.record()` gains `autoVerified` (verified by a system fact: `verified_at` set, `verified_by` empty) and
  `recordCalendarCancel()` adds the superseding `rejected` row with source `calendar`.
- New endpoints (in `docs/AUTHZ-MATRIX.md`): `POST /integrations/google-calendar/connect` and `DELETE /integrations/google-calendar`
  (admin, manager). The shared callback `GET /auth/google/callback` now also routes `calendar-connect`.
- The Inbox outcome label says "from Google Calendar" for such rows instead of "by the team".

**Google verification impact (checked, 2026-11-22).** Google's own scope-verification page uses "reading events stored in Google Calendar"
as its example of a **sensitive** scope; the exact flag for this scope is shown on the OAuth consent screen when it is added, so confirm it
there. It is not a restricted scope (no security assessment on its own). While the OAuth app is in **Testing** mode it works only for
accounts listed as test users, and a Testing-mode refresh token expires after 7 days (the card then says "Reconnect needed").
Going public needs sensitive-scope verification (brand check, scope justification, demo video; days to weeks). `gmail.readonly`, already in use,
is restricted and needs the heavier assessment, so the calendar scope adds little on top.

**Cloud steps (each explained, with cost, and run only on Aman's go; project `supersaas-513613`).**
1. Enable the Calendar API: `gcloud services enable calendar-json.googleapis.com` (free). Without it the sync records "Google Calendar error
   (HTTP 403)" on the card and keeps trying.
2. Run migration `0061` on Cloud SQL (migrate job; no core-lane chat may be running).
3. Deploy the API and the web.
4. Aman (console): add the `calendar.events.readonly` scope under OAuth consent screen > Data access, and the calendar's Google account as a
   test user. Then Connect Google Calendar in Settings and make a test booking.

**Turn on / off.** Nothing to switch on: it runs for a workspace once its calendar is connected. Off: Disconnect on the Settings card (outcomes
already recorded stay, they are history).

### Part B: Looker Studio learning dashboard

**What it is.** A Looker Studio report with four pages (what works by factor, when to send, review history, targeted vs baseline search) plus
a "Data as of" tile. Aman builds it by following `docs/LOOKER-STUDIO.md` (about 30 minutes). The operator console shows a **Learning dashboard**
card with an **Open the dashboard** link once `LOOKER_DASHBOARD_URL` (an `https://lookerstudio.google.com/...` address, validated) is set on the API.

**Why it cannot show another customer's data.** Looker reads only the dataset `expelly_demo`. Its five views (`demo_factor_funnel`,
`demo_send_time_grid`, `demo_review_history`, `demo_search_policy_compare`, `demo_data_freshness`) each select from one `expelly_learning`
view with `WHERE org_id = '<demo workspace id>'` and drop the `org_id` column. The id is passed to `infra/bigquery/apply-demo.sh` on the
command line (it must be a UUID) and is never stored in git. A Jest guard (`apps/api/src/insights/demo-views.spec.ts`) fails the build if a
demo view loses its filter, reads the raw dataset, writes anything, or if the script gets a default id. The dataset is made an authorized
dataset on `expelly_learning` so a viewer who can read only `expelly_demo` can still query the views.

**Cloud steps (each explained and run only on Aman's go).**
1. **DONE 2026-11-23** (demo workspace chosen by Aman from a read-only lookup of workspace ids with their email counts)
   `PROJECT=supersaas-513613 DEMO_ORG_ID=<demo workspace id> infra/bigquery/apply-demo.sh`: creates `expelly_demo` (free), creates the views
   (free, scans nothing) and edits the `expelly_learning` access list to authorise the dataset (free). Two views are skipped until the first
   Review revision and the first Search preference exist (same as T07's `review_history` and `search_policy_compare`).
2. **DONE 2026-11-23** the dashboard was built in the built-in browser (two pages so far: What works, When to send; pages 3 and 4 wait for data) and shared as **Unlisted** (anyone with the link can view; not Public), on Aman's go.
3. **DONE 2026-11-23** `LOOKER_DASHBOARD_URL` set on the API (revision 00025). The link is not stored in git.

**Cost.** None beyond what exists: the views cost nothing until queried; each dashboard refresh scans the (small) views inside the free tier.
