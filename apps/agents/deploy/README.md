# Deploying the agents to Google Cloud (Agent Engine)

**Nothing here has been run.** Each step creates something in Google Cloud, so Aman approves them
first. `deploy_agent_engine.py` is a dry run until you add `--apply`.

## What you get

Each agent runs as its own managed service on **Vertex AI Agent Engine** (Google has renamed it
"Agent Platform"; same thing). It speaks A2A, is registered in **Agent Registry** so it can be
found, and its calls show up in **Cloud Trace**. The API calls it with a Google login token from
its own service account.

## Region

Use **`us-central1`** (where Vertex AI and Agent Engine are most complete). The app's data stays in
`asia-south1`; the agents only see the aggregates and subject lines the API sends them. If you
want Mumbai, check Google's "Agent locations" page first: not every region has Agent Engine.

## Cost (list price at the time of writing; confirm on Google's pricing page)

- Agent Engine runtime: about **$0.085 per vCPU-hour + $0.009 per GiB-hour**.
- One always-on 1 vCPU / 1 GiB agent is about **$68 a month**; two agents about **$136**.
- **Minimum instances = 0** (the script's default) means it scales to zero when nobody is using it:
  cost is near $0 when idle, but the first call after a quiet spell is slower (a few seconds).
- Gemini calls are billed separately per token (cents at beta volume).
- Cloud Storage bucket for staging, Cloud Trace and Cloud Logging: free tier covers this.

## Steps (each one: what it does, what it creates, cost)

1. **Turn on the APIs** (free to enable): `aiplatform.googleapis.com`, `cloudtrace.googleapis.com`,
   `storage.googleapis.com`.
   ```
   gcloud services enable aiplatform.googleapis.com cloudtrace.googleapis.com storage.googleapis.com --project=<PROJECT_ID>
   ```
2. **Create the agents' service account** (an identity with only the permissions it needs; free):
   ```
   gcloud iam service-accounts create expelly-agents --display-name="Expelly agents" --project=<PROJECT_ID>
   gcloud projects add-iam-policy-binding <PROJECT_ID> --member="serviceAccount:expelly-agents@<PROJECT_ID>.iam.gserviceaccount.com" --role="roles/aiplatform.user"
   gcloud projects add-iam-policy-binding <PROJECT_ID> --member="serviceAccount:expelly-agents@<PROJECT_ID>.iam.gserviceaccount.com" --role="roles/logging.logWriter"
   gcloud projects add-iam-policy-binding <PROJECT_ID> --member="serviceAccount:expelly-agents@<PROJECT_ID>.iam.gserviceaccount.com" --role="roles/cloudtrace.agent"
   ```
   (Vertex AI user = may call Gemini; logging writer = may write logs; trace agent = may write traces.)
3. **Create a staging bucket** (holds the packaged agent code; pennies a month):
   ```
   gcloud storage buckets create gs://<PROJECT_ID>-agent-staging --location=us-central1 --project=<PROJECT_ID>
   ```
4. **Deploy each agent** (creates the Agent Engine service; this is the part that costs money):
   ```
   cd apps/agents
   pip install -e ".[deploy]"
   python deploy/deploy_agent_engine.py --agent review_analyst --project <PROJECT_ID> --staging-bucket gs://<PROJECT_ID>-agent-staging --min-instances 0           # dry run
   python deploy/deploy_agent_engine.py --agent review_analyst --project <PROJECT_ID> --staging-bucket gs://<PROJECT_ID>-agent-staging --min-instances 0 --apply
   python deploy/deploy_agent_engine.py --agent copywriter     --project <PROJECT_ID> --staging-bucket gs://<PROJECT_ID>-agent-staging --min-instances 0 --apply
   python deploy/deploy_agent_engine.py --agent discover       --project <PROJECT_ID> --staging-bucket gs://<PROJECT_ID>-agent-staging --min-instances 0 --apply
   ```
   **Discover (T10) also needs two settings on the agent** so it can call the API's page-reading tool:
   `DISCOVER_TOOLS_URL` (the API's address) and, if the audience differs from that address,
   `DISCOVER_TOOLS_AUDIENCE`. The agent proves who it is with a Google ID token for the API (its service
   account, no key). On the API service set `AGENT_TOOLS_AUDIENCE` (the API's address) and
   `AGENT_TOOLS_SA_EMAIL` (the agent's service account): the API accepts only that account.
5. **Register both in Agent Registry** (so other agents and people can discover them): follow Google's
   `agent-platform-agent-registry` skill / docs page for the current command, using each agent's
   Agent Card. Take a screenshot of the listing for the T09 report.
6. **Let the API call them.** Give the API's Cloud Run service account permission to call the agents
   (`roles/aiplatform.user`), then set on the API service: `REVIEW_EXPLAINER=agent`,
   `COPYWRITER_DRIVER=agent`, `REVIEW_ANALYST_URL=<agent A2A URL>`, `COPYWRITER_URL=<agent A2A URL>`.
   For Discover: `DISCOVER_DRIVER=agent`, `DISCOVER_AGENT_URL=<agent A2A URL>` (and optionally
   `DISCOVER_AGENT_TIMEOUT_MS`, default 300000). Switch it back with `DISCOVER_DRIVER=native`.
   (If the card is not at `/.well-known/agent-card.json`, also set `A2A_CARD_PATH`.)
7. **Check one Cloud Trace**: open a Review, then Cloud Trace: one trace should show API -> agent ->
   Gemini (the API sends a W3C `traceparent` header; its log line `a2a_call` carries the same
   `trace_id`).

## Rolling back

Set `REVIEW_EXPLAINER=template`, `COPYWRITER_DRIVER=gemini` and `DISCOVER_DRIVER=native` and restart the API: back to the
built-in text and the direct Gemini drafter, with the agents untouched. Delete an agent in the
Agent Platform console, or `gcloud` equivalent, to stop its billing.

## Known unknowns (read before the first real deploy)

- The Agent Engine A2A deploy API is Pre-GA and has been renamed; `_create_remote` in the script
  follows the September 2025 guide and may need a small edit.
- How Agent Engine's A2A endpoint authenticates callers and where its Agent Card lives was not
  confirmed from the docs. The API client sends a Google access token and supports
  `A2A_CARD_PATH`; verify on the first deploy.
