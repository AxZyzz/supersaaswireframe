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
| balanced | reply drafts, edits | `gemini-3.8-flash` | `GEMINI_MODEL_BALANCED` |
| powerful | campaign builder | `gemini-3.8-flash` (Pro once billing is on) | `GEMINI_MODEL_POWERFUL` |

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
- Very slow answers → `gemini-3.8-flash` "thinks" first; for faster drafts set
  `GEMINI_MODEL_BALANCED=gemini-3.5-flash-lite` and restart the API.
- Back to the mock or Bedrock: `AI_DRIVER=mock` / `AI_DRIVER=bedrock`, restart API.

---

## Later phases (not started)

| Phase | What | Notes |
|---|---|---|
| 2 | **Read replies via the Gmail API** (polling or Google push via Pub/Sub) and **detect bounces** from "undeliverable" messages | Needs a Gmail *read* scope, which Google classes as **restricted**: building and testing in testing mode is fine, but public launch needs Google's app verification including a third-party security assessment (weeks, can cost money) |
| 3 | Hosting on Google Cloud: Cloud Run (API + workers), Cloud SQL (Postgres), Memorystore (Redis), Cloud Storage (instead of S3), budgets, Secret Manager | Tied to hosting decision D-C |

**Sending:** Google has no bulk-sending service like SES. On Google, campaigns go
out through Gmail / Google Workspace mailboxes (already built and verified) or
SMTP. A Workspace mailbox allows roughly 2,000 sends a day, far above the warm-up
caps (20–100/day per mailbox) cold email should use anyway. Platform emails
(password reset, notifications) can use Google Workspace's SMTP relay via
`SYSTEM_SMTP_*`.
