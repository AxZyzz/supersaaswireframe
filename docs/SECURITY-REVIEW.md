# Security review: SuperSaaS V1

**Date:** 2026-11-04 · **Branch:** `cloud-session` · **Type:** white-box review + live testing
**Scope:** `apps/api` (NestJS), `apps/web` (Next.js), database migrations, config, dependencies.
Out of scope: hosting/infra (not chosen yet, decision D-C), AWS/SES (not set up), the Phase 0 wireframe.

## Method

1. **Code review** of every attacker-reachable surface: auth/sessions, tenant
   isolation (RLS), role checks, all raw SQL, HTML rendering, outbound
   connections, public endpoints (tracking, unsubscribe, OAuth callback,
   public API), file import, secrets handling.
2. **Live attacks** against a production-mode API (`NODE_ENV=production`,
   real secrets validation, rate limits on, Swagger off) with two separate
   workspaces (attacker A, victim B) plus an agent and a manager in A.
   51 checks, scripted in [`scripts/security/pentest.js`](../scripts/security/pentest.js)
   so they can be re-run.
3. Each finding was **reproduced, fixed, re-attacked**, and pinned by a
   regression test.

## Summary

| # | Finding | Severity | Status |
|---|---|---|---|
| 1 | Open redirect in click tracking (`/t/c/:id?u=`) | Medium | ✅ Fixed |
| 2 | HTML injection into outgoing emails via lead fields | Medium | ✅ Fixed |
| 3 | SSRF: SMTP sender could target internal services | Medium | ✅ Fixed |
| 4 | OAuth CSRF: "Connect Gmail/Sheets" not bound to the browser | Medium | ✅ Fixed |
| 5 | Passwords > 72 bytes silently truncated by bcrypt | Low | ✅ Fixed |
| 6 | Web app sent no security headers (clickjacking) | Low | ✅ Fixed |
| 7 | SMTP `From` display name not structurally encoded | Low | ✅ Fixed |
| 8 | Signup reveals whether an email has an account | Low | ⚠️ Open: product decision |

Live results: **6 vulnerable of 50 checks before → 1 of 51 after** (#8).

## Findings

### 1. Open redirect in click tracking (Medium)
**What:** `GET /t/c/<any-uuid>?u=<any-url>` redirected anywhere, even for a
tracking id that doesn't exist.
**Impact:** phishing links that start with *your* domain
(`https://api.yourdomain.com/t/c/…?u=https://phish.example`), which also
damages the sending domain's reputation with spam filters.
**Proof:** `302 Location: https://evil.example/phish` for a random UUID.
**Fix:** every tracked link gets an HMAC of (tracking id, destination)
(`apps/api/src/sending/link-signing.ts`, key derived from `APP_ENCRYPTION_KEY`).
The redirect follows, and records, a click **only** when the signature
matches. Unsigned links, wrong signatures, and a valid signature reused for
another URL all land on the app. (No real campaign emails existed yet, so no
legacy unsigned links needed honouring.)
**Also fixed:** links containing `&` were wrapped HTML-encoded (`&amp;`), so
query strings broke on redirect.
**Tests:** `sending/tracking.integration.spec.ts`, `sending/send-render.spec.ts`.

### 2. HTML injection into outgoing emails (Medium)
**What:** `{first_name}`, `{company}` etc. were inserted into the HTML body
unescaped. Lead data comes from outsiders: CSV, Google Sheets, and the public
API (e.g. a website form).
**Impact:** someone submits a lead whose "first name" is a link or button
plus a victim's email address. The campaign then delivers attacker-written
content to the victim, **from your domain**.
**Proof:** first name `<a href="https://evil.example/login">Your account is
locked - verify now</a>` became a working link in the rendered email (even
wrapped as a tracked link).
**Fix:** `renderTemplate(…, { html: true })` HTML-escapes merge values in
every HTML body (campaign sends, template preview, test sends). Subjects
and plain text are unchanged; the template author's own `{var|fallback}`
text stays as written.
**Tests:** `templates/render.spec.ts`.

### 3. SSRF through SMTP senders (Medium)
**What:** a workspace admin could set an SMTP sender's host/port to anything,
and "Verify" made the API connect there.
**Impact:** probing the server's internal network (Redis, Postgres, cloud
metadata at `169.254.169.254`); the different error messages ("Greeting never
received" vs refused) reveal which ports are open.
**Proof:** senders pointing at `127.0.0.1:6379`, `localhost:5432` and
`169.254.169.254:80` were accepted and connected to.
**Fix:** `apps/api/src/senders/smtp-guard.ts`. Mail ports only
(25/465/587/2525). Private, loopback, link-local, CGNAT, multicast and
reserved addresses (IPv4, IPv6 and IPv4-mapped IPv6) are refused when saving,
and **again at every connection after DNS resolution**. The connection then
goes to the vetted IP, with TLS still checking the hostname, which blocks
DNS-rebinding. `SMTP_ALLOW_PRIVATE_HOSTS=on` lifts the address rule for a
genuine internal mail server or a local test inbox.
**Tests:** `senders/smtp-guard.spec.ts`.

### 4. OAuth CSRF on "Connect Gmail / Google Sheets" (Medium)
**What:** the signed `state` proved *which workspace* started the connect,
but not *which browser*.
**Impact:** an attacker starts "Connect Gmail" in their own workspace and
sends the Google link to a victim. If the victim approves, the victim's Gmail
(send permission) or Sheets is attached to the **attacker's** workspace.
**Fix:** starting a connect sets a random, httpOnly, 10-minute cookie
(`ss_goauth`, path `/auth/google`). The state carries its SHA-256, and the
callback only completes when the same browser presents it; the cookie is
then cleared (single use). It uses `SameSite=Lax`, never Strict, because
Google's redirect back is a cross-site top-level navigation.
**Tests:** `senders/gmail-oauth.integration.spec.ts`,
`integrations/sheets.integration.spec.ts`: no cookie and someone else's
cookie are both refused, and nothing gets connected.

### 5. bcrypt truncation (Low)
**What:** bcrypt uses only the first 72 bytes of a password.
**Proof:** a different password sharing the first 72 characters logged in.
**Fix:** passwords over 72 bytes are refused (signup, invite registration,
reset) with a clear message. The limit counts bytes, so emoji and accented
letters count more than one.

### 6. Missing web security headers (Low)
**What:** the Next.js app set no headers and could be framed by any site.
**Fix:** `apps/web/next.config.ts` adds `X-Frame-Options: DENY`,
`frame-ancestors 'none'`, `base-uri`/`form-action 'self'`,
`object-src 'none'`, `nosniff`, `Referrer-Policy` (reset-link tokens never
leak past our origin), `Permissions-Policy` and HSTS; `X-Powered-By` removed.
A full `script-src` CSP is future work (needs nonces for Next's inline
scripts).

### 7. SMTP From header (Low)
The display name was pasted into `"Name" <addr>`; a crafted name could break
the header. It's now passed as a structured `{ name, address }`, which
nodemailer encodes.

### 8. Signup account enumeration (Low, open)
`POST /auth/signup` answers `409 Email already registered`. Login and
"forgot password" correctly don't reveal this. Signup is rate-limited (10/min
per IP), so harvesting is slow. A complete fix needs email verification
before an account exists ("check your inbox"), which is a product decision.

## Verified secure (live)

- **Tenant isolation:** 13 IDOR attempts on another workspace's leads,
  templates, segments and senders (read, edit, delete, verify, test-send, add
  members) all returned 404; the victim's data was unchanged. Postgres RLS
  backs this up under the app layer.
- **Roles:** agents can't invite, add senders, delete the workspace, or
  connect Sheets. Managers can't invite admins or promote themselves.
  Workspace admins can't reach the operator console. Invite links are
  single-use and bound to the invited email.
- **Tokens:** `alg=none`, weak/guessed secrets, and a tampered `orgId` are
  rejected; OAuth state and access tokens can't be swapped for each other.
- **Sessions:** refresh token only in an `HttpOnly; Secure; SameSite=Lax`
  cookie scoped to `/auth`; refresh needs an anti-CSRF header; rotation with
  reuse detection; password reset revokes every session.
- **Brute force:** login is rate-limited and spoofed `X-Forwarded-For` doesn't
  bypass it (only trusted when `TRUST_PROXY` is set). Waitlist and reset
  endpoints are limited too.
- **Enumeration:** login and forgot-password answer identically for unknown
  emails.
- **Injection:** all SQL is parameterised; sort column/order are whitelisted;
  segment rules use whitelisted fields/ops with bound values.
- **XSS:** inbox replies render as text; template HTML goes through an
  allow-list sanitizer; the unsubscribe page doesn't reflect input; CSV
  exports neutralise formulas.
- **Mass assignment:** unknown body fields are rejected (`isOperator`, `plan`).
- **Secrets:** SMTP passwords and Google tokens are AES-256-GCM encrypted and
  never returned by the API; reset tokens are stored hashed; the boot check
  refuses weak production secrets.
- **Transport/headers:** Helmet (HSTS, nosniff, frame protection); CORS allows
  only the web origin; Swagger is off in production; oversized bodies get 413;
  errors carry no stack traces.
- **Realtime:** sockets without a valid access token are disconnected.
- **Dev-only endpoints:** `/inbox/simulate-reply` returns 403 in production.

## Recommendations (not yet done), by priority

1. **Two-factor login (TOTP) for admins/managers** before public launch. These
   accounts can send email as the company's connected mailboxes.
2. **Per-account login throttling.** Today's limit is per IP, so a distributed
   guesser can still target one account (add, e.g., 10 failures/15 min per
   email, plus a "suspicious sign-in" email).
3. **Email verification at signup.** Also closes #8.
4. **Production infra (with D-C):** private networking for Postgres/Redis,
   TLS + a password on Redis, no public DB ports. `docker-compose.yml`
   exposes both with default credentials and is for local use only.
5. **Least-privilege AWS IAM:** replace the `*FullAccess` policies in
   `docs/SETUP-ACCOUNTS.md` with scoped SES/SNS/Bedrock/S3 permissions.
6. **Audit log** of sensitive actions (role changes, sender/Sheets connects,
   exports, deletions, operator actions).
7. **Key rotation plan:** `APP_ENCRYPTION_KEY` protects sender credentials and
   signs click links; add key versioning before it ever needs rotating.
8. **Dependencies:** CI fails only on *critical* advisories. Enable
   Dependabot/Renovate. Known open: `js-yaml` (moderate) inside
   `@nestjs/swagger` 11, not reachable here (Swagger only writes YAML; the bug
   is in parsing) and fixed by the NestJS 12 upgrade.
9. **AI prompt injection (informational):** inbound replies are sent to Claude
   for classification and draft replies. Drafts are human-reviewed; keep it
   that way (never auto-send AI output), and treat classifications as hints.
10. **Strict CSP** with nonces (`script-src`) once the web app is deployed.

## Re-running

Start a **local or staging** API in production mode (never real production:
the script creates test users), then run the checks:

```bash
NODE_ENV=production API_PORT=4100 API_URL=http://localhost:4100 \
JWT_ACCESS_SECRET=<random 32+ chars> JWT_REFRESH_SECRET=<different 32+ chars> \
APP_ENCRYPTION_KEY=<64 hex chars> SEND_SCHEDULER=off JOBS_SCHEDULER=off \
node apps/api/dist/src/main.js
```

```bash
BASE=http://localhost:4100 node scripts/security/pentest.js /tmp/pentest.json
```

---

# Addendum: the Learning Loop (T01 to T17)

**Date:** 2026-11-23 · **Branch:** `ll/T18` from `google-stack` `65bf3a0` · **Type:** white-box review of what the
Learning Loop added, against the local database. **No live system was touched** (billing for the Google Cloud project
was found closed the same day, so nothing in the cloud could be checked or changed).
**Scope (T18 section 3):** the new endpoints and agents, row-level security (RLS), the authz matrix, the internal cron and
agent-tool endpoints, SSRF on agent fetches, prompt-injection paths, PII in BigQuery and agents, idempotency keys and
rate limits. Everything here is from reading the code and querying the local database; nothing was exploited live.

## Summary

| # | Finding | Severity | Status |
|---|---|---|---|
| 1 | `POST /review/simulate` (any role, agent included) stored a row on every call, with no cap | Low-Medium | ✅ Fixed |
| 2 | `GET /insights` and `POST /search-preferences/propose` could run BigQuery queries with only the global 100/min limit | Low | ✅ Fixed |
| 3 | Model Armor (prompt-injection screening) is **off in production**: `SAFETY_DRIVER` defaults to `off` and the template was never created | Medium (operational) | ⚠️ Open: needs the cloud. Startup now warns |
| 4 | `fetch-pages` lets the Discover agent name any domain (bounded by a per-run cap and the SSRF guard) | Info | Accepted |
| 5 | Free-mail company keys are hashed in BigQuery views with an unkeyed 64-bit SHA-256 prefix | Info | Accepted, hardening noted |
| 6 | The review refresh cooldown is in memory per API instance | Info | Accepted (one instance in production) |
| 7 | The global rate limit is per client IP: correct only if `TRUST_PROXY` is right behind Cloud Run | Info | ⚠️ Not verifiable now (live) |

No high findings. Findings 1 and 2 are fixed and pinned by `src/auth/security-t18.integration.spec.ts`.

## Findings

### 1. Unbounded "Try simulation" rows (Low-Medium, fixed)
Any role may call `POST /review/simulate`, and each call inserted a (flagged `simulated = true`) row with the inputs, result
and explanation JSON. The global limit (100 requests/min per IP) was the only brake, so one signed-in member could add
about 6,000 rows an hour to the workspace's database. **Fix:** a route limit of 10/min, and each call now keeps only the
workspace's newest 20 simulated reviews (older ones deleted in the same transaction; real reviews are never touched and the
tenant policy limits the delete to the caller's workspace). The newest simulation can still be opened by id.

### 2. BigQuery cost amplification (Low, fixed)
With `INSIGHTS_SOURCE=bigquery` each Insights request can run BigQuery queries (billed per byte scanned), and `propose`
reads the same evidence. Both had only the global limit. **Fix:** `GET /insights` 30/min, `POST /search-preferences/propose`
20/min (a person previews a few times; `propose` stores nothing). The Postgres answer on any BigQuery error is unchanged.

### 3. Model Armor is not active in production (Medium, open)
`SAFETY_DRIVER` defaults to `off`, `off` is accepted in production, and the Model Armor template was never created (T08).
So inbound replies and fetched web pages reach the model unscreened, and AI text a person will send is not screened on the
way out. The layers that do not depend on it hold (see "Verified secure"): code verifies every Discover claim against the
fetched pages, AI explanations are schema-checked with a template fallback, AI labels are only *provisional* until a person
confirms them, and nothing AI-written is ever sent without approval. **Done in code:** a warning at API start-up when the
screen is off in production, so it is visible in the logs. **Still to do (cloud, needs Aman's go and working billing):**
create the template, set `SAFETY_DRIVER=modelarmor` and `MODEL_ARMOR_TEMPLATE`, and decide `SAFETY_FAIL_MODE` (web pages
already fail closed in code). This belongs in the T18 deploy checklist.

### 4. The agent chooses the domain it reads (Info, accepted)
`POST /internal/agent-tools/fetch-pages` takes `orgId`, `runId` and `domain` from the caller. The caller must be the Discover
agent's service account (checked below), the run must exist in that workspace and still be running, a run may read at most
`MAX_AGENT_FETCHES_PER_RUN` companies, and every fetch goes through the SSRF guard. A prompt-injected agent could therefore only
make the API read more public websites, within the cap. Optional hardening: only allow domains the run proposed.

### 5. Hashed free-mail keys (Info, accepted)
The BigQuery views turn `email:<address>` company keys into `email:` plus 16 hex characters of SHA-256. That cannot be reversed,
but anyone holding a candidate address can confirm it. The raw dataset is locked and the views are the only readers. If this
ever leaves the team, switch to a keyed hash (HMAC with a secret held outside BigQuery).

### 6. In-memory refresh cooldown (Info, accepted)
`POST /campaigns/:id/review/refresh` is limited to once per 30 s per campaign in process memory. With the production setting
of one API instance that is exact; if the API is ever scaled out, move it to Redis (the global limit is already shared).

### 7. Rate limit keyed by IP (Info, not verifiable now)
The global limit uses the client IP. Behind Cloud Run that is only correct if `TRUST_PROXY` is set to the right number of
hops: unset, every user would share one bucket; too high, `X-Forwarded-For` can be spoofed. `GET /operator/request-ip` shows
what the API sees: check it on the next live visit.

## Verified secure

- **Row-level security.** Of 50 tables, 45 have RLS enabled **and forced**, every table with an `org_id` is among them, and
  none has RLS on with no policy. Every policy is tied to `app.current_org_id` except `owner_bypass`, which applies only to the
  table owner role `supersaas`, not to everyone. The 5 tables without RLS are the global auth tables (`users`,
  `refresh_tokens`, `password_resets`, `email_verifications`, `waitlist`): none has an `org_id`.
- **Cross-tenant functions.** All 23 `SECURITY DEFINER` functions pin `search_path`, and `EXECUTE` is granted only to the owner
  and the app role. The four added by the Learning Loop (`active_search_preferences`, `expire_search_preferences`,
  `loop_workspaces`, `due_calendar_syncs`) run fixed SQL with no caller input and return only ids.
- **Authz matrix.** 219 routes, generated from the controllers and checked by a test. The public routes are the auth and
  tracking ones from V1 plus the three cron routes and the agent-tool route, which have their own guards (next item). The
  state-changing routes an `agent` can call are the inbox, leads, notes, tags, notifications, `POST /outcomes`,
  `POST /outcomes/:id/verify` (agents confirm outcomes by design), `POST /review/simulate` and `POST /templates/:id/preview`.
  Approving, pausing, resuming, refreshing and search preferences are admin and manager only, and the services check the role
  again. No Learning Loop route is missing a role check.
- **Internal endpoints.** `/internal/cron/*` and `/internal/agent-tools/*` accept only a Google-signed ID token whose
  signature, audience and **verified email equal the configured service account**; anything missing in the configuration means
  401 (fail closed); the development shared secret works only when `NODE_ENV=development`; secrets are compared in constant
  time. A signed-in user gets 401. (Specs: `internal/cron.integration.spec.ts` and `prospects/agent-tools.guard.spec.ts`.)
- **SSRF.** The only outbound fetcher for agents is the web reader: http(s) on ports 80 and 443 only; every hostname goes
  through a lookup that refuses private, loopback, link-local (cloud metadata), unique-local, IPv4-mapped, 6to4, Teredo and
  other reserved addresses, and **all** answers must be public (so DNS rebinding does not help); IP-literal hosts including odd
  spellings are refused; each redirect hop is re-checked; the 1.5 MB cap is counted on the **decompressed** stream (a gzip
  bomb is cut off) with an idle timeout and a hard wall-clock deadline; `robots.txt` is honoured.
- **Prompt injection.** Third-party text (web pages, replies) is screened on the way in when Model Armor is on, and a page is
  skipped if the check errors (fail closed). Independent of that: emails and locations come from the fetched pages, never from
  the model; every quote and trigger is verified against the page text; the Review analyst gets aggregates only (counts, rates,
  finding ids), never lead text; its answer is schema-validated and falls back to a template; AI qualified-reply labels stay
  provisional until a person confirms; challenger subjects stay drafts until previewed and approved.
- **PII in BigQuery and agents.** 17 tables replicate listed columns only (grant, publication, Datastream include list and
  `replication-set.json` agree, guarded by a spec). The views read only categorical fields (industry, size band, role bucket,
  country, timezone, `triggers[0].type`, hashed company key): no quotes, emails, names, titles, phones or message ids. The raw
  dataset is locked to Datastream. The new `send_window` columns are on none of the lists.
- **Idempotency.** Review actions (`UNIQUE (org_id, idempotency_key)`, revision check, row lock), outcome events (same unique
  key), search preference approval and revert (state checks), experiment start and stop (state checks). Covered by the
  T03, T11 and T12 specs.
- **Secrets.** No key, token or private-key pattern in any tracked file, and no `.env` is tracked.
- **T17 (send windows).** Window input is validated field by field and stored in canonical form (never the raw request);
  recipient timezones are checked as real IANA names and fall back safely; the window maths loops at most 9 local days;
  creating or editing a test needs admin or manager and is frozen while a test runs.

## Not verified (needs the cloud, or not built)

Billing for the project was closed on 2026-11-23, so none of this could be looked at: `TRUST_PROXY` and the live rate-limit
behaviour (finding 7), the Cloud Scheduler job's service account and audience matching `CRON_SA_EMAIL` and `CRON_AUDIENCE`, the
Agent Engine identity (agents are not deployed yet), Model Armor with real traffic (finding 3), and Agent Gateway and Apigee
(T15, not built). Real prompt-injection attempts against live Gemini were not run. The V1 live attack script
(`scripts/security/pentest.js`) was not re-run in this pass.
