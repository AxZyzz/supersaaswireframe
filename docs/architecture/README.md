# SuperSaaS architecture diagram: how to read it

| File | What |
|---|---|
| `supersaas-architecture.excalidraw` | **The diagram.** Open it at excalidraw.com (menu → Open) or in Obsidian's Excalidraw plugin. Editable. |
| `supersaas-architecture-preview.png` / `.svg` | Quick static preview (rough fonts; for a glance on GitHub) |
| `generate.py` | Regenerates both from the content lists inside it: `python docs/architecture/generate.py` |

Status as of **2026-11-19** (branch `google-stack` at the reply-sync commit).

## Colours

| Colour | Meaning |
|---|---|
| **Blue** | Done: built, tested, working |
| **Yellow** | Partial: built, but waiting on an account, a public URL, or a live test |
| **Red** | Not done: not built yet, needs an outside account, or deferred on purpose |
| Grey | Who uses the product (no status) |
| Purple | Design notes and trade-offs |
| `*` | Exists on `google-stack` only (Gemini, Gmail reply reading, sender name/signature edit) |

Each box also carries its status in words (`[DONE]`, `[PARTIAL]`, `[NOT DONE]`)
so it reads without colour.

## The architecture in one paragraph

SuperSaaS is two apps and two data stores. **apps/web** (Next.js, port 3000)
is everything the user sees. It talks to **apps/api** (NestJS, port 4000)
over REST with a short-lived access token held in memory, plus an httpOnly
refresh cookie and a Socket.io connection for live updates. The API is **one
process** that does three jobs: answers requests, pushes realtime events, and
runs every background worker (CSV imports, segment refresh, the 30-second send
scheduler, notification emails, Sheets sync, Gmail reply sync). All data
lives in **Postgres**, where row-level security keeps each workspace's rows
invisible to every other workspace even if a query forgets to filter. **Redis**
holds the job queues, the shared schedules, rate-limit counters and realtime
fan-out. Outside services (Gmail, SMTP servers, Gemini or Bedrock, Google
Sheets) are reached only from the API, never from the browser.

## Walking the diagram top to bottom

1. **Who uses it.** Workspace users (admin / manager / agent roles), the A2B
   operator (staff console), website visitors, the leads who receive emails,
   and outside systems that push leads with an API key.
2. **Frontend.** 2a public + auth pages, 2b every logged-in page with its
   features listed, 2c the shared shell and client plumbing. On the right,
   2d is traffic that skips the web app and hits the API directly: tracking
   pixels and click links from recipients' mail apps, the public `/v1/leads`
   API, the Google OAuth callback and health checks.
3. **Backend.** 3a what runs on every request (auth, roles, tenant isolation,
   rate limits, validation, plan limits). 3b the feature modules with what
   each does. 3c the queues and scheduled jobs.
4. **Data.** Postgres (46 migrations, the table list) and Redis. Red: object
   storage and automated backups.
5. **External services.** Blue: Gmail send, SMTP servers, Gemini. Yellow: Gmail
   read, Sheets, Bedrock (built, never run for real), system SMTP (login
   rejected). Red: everything on AWS SES / SNS, Sentry, Outlook, Stripe.
6. **Infrastructure.** Local Docker, GitHub, CI are done. Everything about
   putting it on the internet (public URL, hosting for web and API, managed
   database, domain + DNS, production secrets) is red.
7. **Workflows.** Seven end-to-end flows left to right: onboarding, lead
   intake, campaign sending, opens/clicks, replies, bounces, password reset.
   Yellow steps show exactly where each flow currently stops working for real.
8. **What's left.** Accounts and actions for Aman, decisions, security work
   before launch, known code gaps, launch sequence, deferred items.
9. **Design notes.** Why it's built this way and where it will hurt first.

## Where the yellow and red cluster

- **Going public is the main blocker.** Opens, clicks and unsubscribe links
  point at `API_URL`; while that is `localhost` the recipient's mail app can't
  reach them. A Cloudflare tunnel fixes it for testing; hosting fixes it for
  real (web on Vercel; API on a container host, because Vercel can't run
  long-lived workers or websockets).
- **Accounts.** System SMTP (535 login error), AWS (SES sending, bounce
  webhooks, Bedrock), Sentry.
- **Live tests.** Gmail reply reading and Google Sheets are built and covered
  by automated tests but haven't been exercised with real accounts yet.
- **Decisions.** Name + domain, market, hosting, beta size, email verification,
  legal review.

## Keeping it current

When something changes, edit the matching line in `generate.py` (content
lists near the top; status letters `D` done, `P` partial, `T` not done), run
`python docs/architecture/generate.py`, and commit the regenerated files.
Re-render the PNG preview if you want it to match (optional).

Related: `docs/RUNNING-LOCALLY.md` (how to run it), `docs/BUILD-SUMMARY.md`
(full record), `docs/GOOGLE-STACK.md` (Gemini + Gmail reading),
`docs/AUTHZ-MATRIX.md` (every route and who can call it).
