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
- Gemini 2.5+ models "think" before answering and those tokens count toward the
  output cap, so the adapter adds headroom (`+8192` tokens) to avoid JSON cut off
  mid-answer. You pay only for tokens actually used.
- Token usage (including thinking tokens, which are billed as output) is logged
  to `ai_usage` like every other provider, so usage meters and quotas still work.
- An empty answer (safety block, token cap) becomes a clear error with Google's
  reason instead of a silent blank.

### Models per tier
| Tier | Used for | Default model | Override |
|---|---|---|---|
| fast | reply classification | `gemini-2.5-flash-lite` | `GEMINI_MODEL_FAST` |
| balanced | reply drafts, edits | `gemini-2.5-flash` | `GEMINI_MODEL_BALANCED` |
| powerful | campaign builder | `gemini-2.5-pro` | `GEMINI_MODEL_POWERFUL` |

Google renames and retires models often. After adding a key, check the current
list in Google AI Studio and override if a newer model fits better.

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
2. **In the app:** Campaigns → AI draft (generate a sequence, then "Ask AI to
   edit"); Inbox → Test reply (gets classified) → Draft with AI.
3. Automated tests never call Gemini: Jest forces the mock (`test/setup-env.ts`).

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
