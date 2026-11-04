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
