# Expelly demo script (3 to 4 minutes)

**Written:** 2026-11-23 (T18 section 5) · **Status:** draft to rehearse. It has **not** been run end to end: the live site was
down when this was written (Google Cloud billing closed, see `docs/RESTORE-RUNBOOK.md`), so every on-screen label below that is
not quoted from the product is marked *(confirm in rehearsal)*. Timings are targets.

**One honesty rule for the whole demo:** anything that needs weeks of data (a real winner, real replies) is shown with
**Try simulation**, and we say so out loud while the red "Simulated data, not your results" banner is on screen. Never present a
simulation as a customer result.

## Before you start (10 minutes, the day before and again 30 minutes before)

- [ ] The site answers: `https://supersaas-web-108226687455.asia-south1.run.app/login` loads; `/api/health/ready` is 200. **If it
  does not, use Plan B below.**
- [ ] A demo workspace with: a connected sender, an offer, at least one finished Discover search (so evidence quotes are on
  screen), one campaign with a running test and some real or imported sends, and one past Discover run to show the allocation.
- [ ] Decide which Discover driver is on. `DISCOVER_DRIVER=agent` (the ADK agent on Agent Engine) is **not deployed yet**; with
  `native` the same page works but the agent claim on the slide must be changed (see "What to claim").
- [ ] Browser tabs open in order: Discover, Campaigns (Setup tab), Review, Insights, the architecture slide. Zoom 125%, dark
  mode as the app defaults. Notifications off.
- [ ] A second mailbox you control, in case you send one live email.
- [ ] Do not open Settings, the operator console, or anything showing real customer emails.
- **Plan B (site down):** run it locally with the mock AI and mock email (`docs/RUNNING-LOCALLY.md`: Docker Postgres and Redis,
  `npm run dev:api`, `npm run dev:web`). Say so up front ("running on my laptop; the cloud deployment is the same code").

## The script

### 0:00 to 0:20 · The problem, in one line
> "Outbound sales is guesswork: which subject, which companies, which time. Expelly finds companies with proof, tests what to
> say, learns what works, and a person approves every change."

Show the one-slide loop: **Discover → Campaigns → Review → Discover**.

### 0:20 to 1:00 · Discover: companies with evidence
1. Open **Discover**, start (or open) a search: the goal and offer are already written.
2. Point at the **Agent steps** feed while it runs ("reading acme.com", one line per company). *(With `native` driver say "the
   search steps", not "the agent".)*
3. Open a company: the **verbatim quote and the URL** it came from, location, industry, size, and the **trigger** chips
   (hiring, expansion, funding, product launch).
> "Every claim has a quote from the company's own site, checked by code against the page. If we cannot prove it, it says
> unknown. Emails come from the pages, never from the AI."
4. Click **Add to leads** (segment name optional).

### 1:00 to 1:40 · Campaigns: a real test, per company
1. **Campaigns**, pick the campaign, **Setup** tab. Point at the **Send timing** card (send window, and **Test two send times**)
   and the **A/B test (company-level)** panel.
2. Show two subject lines and the sentence: "We'll judge on confirmed qualified replies within 14 days. Each company sees one
   version across all contacts and retries."
> "Each company is randomly given one version and keeps it, even if two people there get the email. Once it starts, the copy,
> audience and windows are frozen so the result can be trusted."
3. One sentence on timing: "The same machinery can test *when* to send: two windows, same email, only the time differs."

### 1:40 to 2:20 · Review: an explained result, with uncertainty
1. **Review** tab of the campaign. Show the table (companies, sent, confirmed qualified) and the **difference bar** with the dashed
   "smallest worthwhile lift" line.
2. If real data is thin, choose **Try simulation → valid winner**. **Say it:** "This is simulated data. The banner says so."
3. Read the recommendation and the **Checks** list: "Keep collecting" with the reason when a check fails.
> "The numbers come from the backend, not the AI. The AI only explains them in plain words, and if it invents a number we
> throw its text away and show the template. It never decides."
4. Switch the scenario to **misleading city effect**: "the city looks great, the overall result is inconclusive; we do not act
   on a slice." Then **high opens, low conversion**: "more opens, fewer qualified replies: opens are never the goal."
5. Click **Pause B** (or **Keep testing**): the dialog states exactly what changes ("stops being used for new companies;
   companies already on it keep it; you can resume"). On a simulation it says "nothing changes". *(Do not click it on real data
   unless you mean it.)*

### 2:20 to 2:50 · Insights: what works, where and when
1. **Review → Insights**. Show a factor (city or industry) and the "exploratory, not a decision" label; a bucket with too little
   data is hatched and says "not enough data yet".
2. Show **Send time** (heatmap) or, if thin, the line "Run a send-time test".
> "It tells us where replies come from, honestly: small groups are never called a winner."

### 2:50 to 3:20 · Close the loop: approve the next search
1. From Insights, **Apply to next search** (or the preference dialog): show the **exact filter, the 20% cap, the 14-day expiry
   and the evidence link** before approving.
2. Approve (admin or manager), then open **Discover**: the next search carries the preference tag and shows what it found against
   the cap, with a shortfall filled from the normal search, and a **Withdraw** button.
> "Only up to 20% of a search is reserved for the winning group, it expires by itself, and one click puts everything back."
3. Click **Withdraw** to show it reverts. *(Confirm in rehearsal: exact run-header wording.)*

### 3:20 to 3:50 · The Google Cloud architecture slide
One slide, grouped, with **what is live** marked:

- **Live:** Cloud Run (API, web), Cloud SQL (Postgres), Gemini (model router), BigQuery + Datastream (learning plane),
  Knowledge Catalog + Data Lineage, Cloud Scheduler, Cloud Monitoring (alerts), Cloud Trace (on the API), Secret Manager,
  Cloud Build + Artifact Registry, Google Calendar API (booked calls), Looker Studio (dashboard).
- **Built and tested, not deployed yet:** ADK agents on Vertex AI Agent Engine (Review analyst, Copywriter, Discover), the A2A
  protocol and Agent Registry, **Model Armor** (screening is off in production until its template is created).
- **Designed, not built:** Agent Gateway and Apigee token metering (stretch).

> "Postgres stays the source of truth; BigQuery is a learning copy with no personal data. The agents see aggregates only."

## What to claim, and what not to

| Say | Do **not** say |
|---|---|
| "A person approves every change; code decides, AI drafts." | "The AI optimises your campaigns by itself." |
| "Every Discover claim is verified against the company's page." | "Discover is always right." |
| "Review compares companies, not emails, with a confidence interval." | "We found a winner" on simulated data. |
| "Model Armor and the agents are built and tested; deploying them is the next step." | "Everything is live on Google Cloud" or "prompt-injection protection is on" (it is not yet). |
| "This part is simulated because it needs weeks of data." | Hide the banner or crop it out of a screenshot. |

## Likely questions (honest answers)

- **Does the AI send or change anything?** No. It drafts and explains; people approve, and the server re-checks the role.
- **How long does a test take?** It depends on volume and on how big the difference really is. Review shows how many companies
  per version it would still need, worked out from the lift seen so far and the "smallest worthwhile lift" (2 points by
  default), plus the 14-day reply window. Example with the product's own formula (3% baseline, 5% significance, 80% power, 2-point
  minimum): a lift of 4 points needs about 1,850 companies per version, 5 points about 900, 8 points about 280; a 3-point lift
  about 6,700. If that is out of reach at your volume it says "keep the control". Small volumes get "keep collecting". (Numbers
  checked by hand against the formula in `review/policy/stats.ts`; the page shows the live figure.)
- **What data goes to the AI and to BigQuery?** Aggregates (counts, rates) go to the analyst; BigQuery holds category fields
  only, with free-mail keys hashed. Raw emails, names and quotes stay in Postgres.
- **Is it multi-tenant safe?** Every table with workspace data has row-level security forced; see `docs/SECURITY-REVIEW.md`.
- **What if a model is down?** Templates and the native driver take over; Insights fall back to Postgres.
- **What is real and what is simulated here?** Say which, per screen.

## After the demo

Note what broke or confused people and add it to `docs/DEV-LOG.md`. Fix wording in this script against the live screens.
