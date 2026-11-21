# Expelly agents (`apps/agents`)

Two small AI "agents" written in Python with Google's **Agent Development Kit (ADK)**. The NestJS
API talks to them over the **A2A** protocol (agent-to-agent: a standard way for one program to ask
another program's AI to do a job).

| Agent | What it does | What it never does |
|---|---|---|
| **Review analyst** | Takes the numbers from a campaign Review and explains them in plain English. Every sentence names the finding ids (F1, F2...) it relies on. | Decide anything. The decision ("keep testing", "promote") is made by code in the API before the agent sees it. |
| **Copywriter** | Drafts 3 challenger email subject lines for the next A/B test. | Send, schedule or apply anything. The API saves a chosen subject as a *draft* and a person approves it. |

**Rule: code decides, AI drafts, people approve.** The API does not trust either agent. It checks
the Review analyst's every finding id, number and word before showing it (`apps/api/src/agents/explanation-validator.ts`),
and if anything is off it shows the plain template text instead. Neither agent ever receives a lead's
name, email or company: the Review analyst gets aggregates only, the Copywriter gets the offer text,
subject lines and your knowledge base.

## How the pieces fit

```
Review page ──► NestJS API ──A2A──► Review analyst (ADK) ──► Gemini
                  │  checks ids, numbers, wording
                  └─ falls back to the template text if anything fails
"Draft a challenger" ──► NestJS API ──A2A──► Copywriter (ADK) ──► Gemini
                  └─ checks length, merge tokens, duplicates, Model Armor; saves a DRAFT only
```

The contracts (what goes in and out) are JSON Schemas in `packages/shared/src/agents/*.schema.json`.
Python (`expelly_agents/shared/schemas.py`) and the API (`apps/api/src/agents/contracts.ts`) both
check the **same fixture files** (`packages/shared/src/agents/fixtures/`), so they cannot drift apart
without a test failing. After changing a schema run `npm run contracts:sync -w apps/api`.

## Switches in the API (all default to "off", so nothing changes until you flip one)

| Setting | Values | Meaning |
|---|---|---|
| `REVIEW_EXPLAINER` | `template` (default), `agent`, `gemini` | `agent` = the Review analyst over A2A; `gemini` = the same instructions as a direct Gemini call (handy without Agent Engine); `template` = the built-in plain text. |
| `COPYWRITER_DRIVER` | `gemini` (default), `agent`, `mock` | `agent` = the Copywriter over A2A; `gemini` = the direct Gemini drafter from T11; `mock` = fixed template subjects, no AI. |
| `REVIEW_ANALYST_URL`, `COPYWRITER_URL` | e.g. `http://localhost:8101` | Where the agents live. For Agent Engine use the agent's A2A endpoint. |
| `A2A_AUTH` | `none` | Skip the Google login token (non-local URLs get one from your Google credentials automatically). |

If an agent is down or slow (30 s limit, one retry, circuit breaker shared with the model router),
the API quietly uses the fallback. Tests never call a real agent or Gemini.

## Run it on your machine

You need Python 3.12+ (tested on 3.13) and a Gemini key in the repo's `.env` (`GEMINI_API_KEY`), the
same one the API uses.

```powershell
cd apps/agents
python -m venv .venv
.\.venv\Scripts\python -m pip install -e ".[dev]"
.\.venv\Scripts\python -m pytest            # no network, no key needed
```

Try an agent in ADK's web page (a chat box for testing agents):

```powershell
.\.venv\Scripts\adk web expelly_agents       # then open http://localhost:8000 and pick review_analyst
```

Serve both as A2A servers (each prints its **Agent Card** at `/.well-known/agent-card.json`):

```powershell
$env:GOOGLE_API_KEY = $env:GEMINI_API_KEY    # ADK reads this name
.\.venv\Scripts\python -m uvicorn expelly_agents.review_analyst.a2a_app:app --port 8101
.\.venv\Scripts\python -m uvicorn expelly_agents.copywriter.a2a_app:app --port 8102
```

Call them from the API's own client and run the API's checks on the answer:

```powershell
npm run try:agents -w apps/api
```

Then, in the API's `.env`: `REVIEW_EXPLAINER=agent`, `REVIEW_ANALYST_URL=http://localhost:8101`,
`COPYWRITER_DRIVER=agent`, `COPYWRITER_URL=http://localhost:8102`, and open a campaign's Review.
The recommendation card says "Explained by Expelly Review agent" when the agent's answer passed.

Models follow the API's task catalogue: Review analyst = `review_explain` (balanced tier,
`GEMINI_MODEL_BALANCED`), Copywriter = `challenger_draft` (powerful tier, `GEMINI_MODEL_POWERFUL`).
Override with `REVIEW_ANALYST_MODEL` / `COPYWRITER_MODEL`.

## Deploying to Google Cloud (Agent Engine) - needs Aman's go first

Not done by the build. `deploy/deploy_agent_engine.py` and `deploy/README.md` hold the steps, the
service account, the region, and the cost. Short version of the cost: Agent Engine bills per vCPU-hour
and GiB-hour (list price about $0.085 and $0.009 at the time of writing, confirm on Google's pricing
page). One always-on 1 vCPU / 1 GiB agent is roughly $68 a month; with minimum instances = 0 it costs
close to nothing when idle but the first call after a pause is slower.

## Versions

Pinned in `pyproject.toml`: `google-adk==2.15.0`, `a2a-sdk==1.3.1`. ADK, A2A and Agent Engine change
quickly (Google has renamed Agent Engine to "Agent Platform"): bump on purpose and rerun `pytest` and
`npm run try:agents -w apps/api`.
