# Account Setup — click-by-click (Aman)

Three external services power sending + AI. Do them **in this order** (SES has a
2-week approval wait, so file it first). As you finish each, open `.env` in the
repo root and paste the value next to its `TODO`, then restart the API.

> Claude cannot log into these consoles for you (they're your accounts +
> credentials). You click through; you paste keys into `.env` (NOT into chat —
> keep secrets out of chat). Then Claude wires the code.

What Claude needs in `.env` when you're done:
`ANTHROPIC_API_KEY`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `SES_FROM_DOMAIN`,
`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`.

---

## §1 — AWS + SES (email sending) ⏳ DO FIRST (2-week approval)

**Why:** SES is what actually sends the campaign emails and reports bounces.

### 1a. AWS account
1. Go to https://aws.amazon.com → **Create an AWS Account** (use the A2B email).
   Needs a card (they charge ~$1 to verify, refunded) + phone verification.
2. Sign in as **root** → search **IAM** → enable **MFA** on the root user
   (security; use an authenticator app).

### 1b. IAM user for the app (so we don't use root keys)
1. IAM → **Users** → **Create user** → name `supersaas-app` → Next.
2. **Attach policies directly** → for now check **AmazonSESFullAccess**
   (we'll tighten later) → Create user.
3. Open the user → **Security credentials** tab → **Create access key** →
   use case **Application running outside AWS** → Create.
4. You'll see **Access key** and **Secret access key** ONCE. Paste both into
   `.env`:
   ```
   AWS_ACCESS_KEY_ID=AKIA...
   AWS_SECRET_ACCESS_KEY=...
   ```
   (`AWS_REGION=us-east-1` is already set — keep it; SES inbound receiving needs
   a supported region and us-east-1 is safest.)

### 1c. Verify a sending domain in SES
1. Top-right region selector → set to **US East (N. Virginia) us-east-1**.
2. Search **SES** → **Configuration → Identities** → **Create identity**.
3. Choose **Domain**, enter the domain you'll send from (e.g. `a2b.com` or a
   subdomain like `mail.a2b.com`). Leave **Easy DKIM** on.
4. SES shows a set of **CNAME records** — add them at your domain's DNS (wherever
   you manage DNS, e.g. Cloudflare/GoDaddy). Verification goes green in minutes-hours.
5. Put the domain in `.env`: `SES_FROM_DOMAIN=a2b.com`

### 1d. Request production access ⏳ (this is the 2-week part — do it now)
1. SES → **Account dashboard** → **Request production access**.
2. Mail type: **Transactional** (+ marketing). Website: your site.
3. Use-case text (paste something like): *"B2B cold-email outreach platform.
   We handle bounces and complaints via SNS webhooks, maintain a suppression
   list, and honor unsubscribes (CAN-SPAM). Sending to opted-in business
   contacts with per-account daily limits and ramp-up."*
4. Submit. Until approved you're in **sandbox** (can only email verified
   addresses) — that's fine for dev; approval unblocks real beta sending.

**S3 (optional, later):** skip for now — CSV import works without it. When
needed: S3 → create a private bucket → put its name in `S3_BUCKET`.

---

## §2 — Google Cloud OAuth (Gmail sending + Sheets import)

**Why:** one setup unlocks (a) users sending from their own Gmail and (b)
importing/syncing leads from Google Sheets.

1. Go to https://console.cloud.google.com → top bar **project dropdown** →
   **New Project** → name `supersaas` → Create, then select it.
2. **APIs & Services → Library** → enable these three (search each, click
   Enable): **Gmail API**, **Google Sheets API**, **Google Drive API**.
3. **APIs & Services → OAuth consent screen**:
   - User type **External** → Create.
   - App name `SuperSaaS`, support email = your email, developer email = yours.
   - **Scopes** → Add: `.../auth/gmail.send`, `.../auth/spreadsheets.readonly`,
     `.../auth/drive.metadata.readonly`.
   - **Test users** → add your own Google address.
   - Save. Leave publishing status **Testing** for now.
   - ⚠️ **Testing-mode trap:** in Testing, connected Gmail tokens **expire every
     7 days**. Fine while you build. Before real beta users connect Gmail, hit
     **Publish app** and start Google's verification for the restricted
     `gmail.send` scope — that review takes weeks, so kick it off early.
4. **APIs & Services → Credentials → Create credentials → OAuth client ID**:
   - Application type **Web application**, name `supersaas-web`.
   - **Authorized redirect URIs** → add exactly:
     `http://localhost:4000/auth/google/callback`
   - Create. Copy **Client ID** and **Client secret** into `.env`:
     ```
     GOOGLE_CLIENT_ID=...apps.googleusercontent.com
     GOOGLE_CLIENT_SECRET=...
     ```

---

## §3 — Anthropic API key (AI features) ✅ instant

**Why:** powers the AI campaign builder, reply classification, reply drafting.

1. Go to https://console.anthropic.com → sign in (A2B account) → add billing.
2. **Settings → Limits** → set a monthly **spend cap** (~$200 for V1).
3. **API Keys → Create Key** → name `supersaas` → copy it.
4. Paste into `.env`: `ANTHROPIC_API_KEY=sk-ant-...`

---

## When each is done, tell Claude

- **Anthropic key in** → Claude builds the AI layer (E6): AI campaign builder,
  reply classification.
- **Google client id/secret in** → Claude wires Gmail sender (T3.3) + Sheets
  sync (T2.8).
- **AWS keys + domain verified** → Claude wires the SES sender (T3.2) and, once
  production access is granted, the real sending engine (E5).

You don't have to wait for all three — hand Claude whichever lands first and it
wires that piece. **Docker Desktop** must be running for local dev (fixed via
`wsl --update`; if it ever crashes again, same rename-run-dir trick).
