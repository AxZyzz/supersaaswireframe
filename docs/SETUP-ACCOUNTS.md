# Account Setup — click-by-click (Aman)

Two accounts power everything still gated: **AWS** (SES sending + bounces +
inbound replies, Bedrock for Claude, optional S3) and **Google Cloud** (Gmail +
Sheets). Do AWS first — SES production access has a ~2-week wait. As you finish each, open `.env` in the
repo root and paste the value next to its `TODO`, then restart the API.

> Claude cannot log into these consoles for you (they're your accounts +
> credentials). You click through; you paste keys into `.env` (NOT into chat —
> keep secrets out of chat). Then Claude wires the code.

What Claude needs in `.env` when you're done (updated 2026-11-02):
`AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION`, `SES_FROM_DOMAIN`,
`AI_DRIVER=bedrock`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` (+ optional `S3_BUCKET`).
**No Anthropic console key** — Claude runs through AWS Bedrock on the same AWS keys.

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
2. **Attach policies directly** → for now check **AmazonSESFullAccess**,
   **AmazonSNSFullAccess** and **AmazonBedrockFullAccess** (+ **AmazonS3FullAccess**
   if you want S3) — we tighten to least-privilege before launch → Create user.
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

## §3 — Claude via AWS Bedrock (AI features) ✅ same-day

**Why:** real AI for the sequence builder and reply classification (today it runs
on a deterministic mock). Uses the AWS keys from §1 — nothing new to paste except
one switch.

1. AWS console → region **us-east-1** → search **Amazon Bedrock**.
2. **Model access** (left nav) → **Modify model access** → tick the Anthropic
   models: **Claude Haiku 4.5**, **Claude Sonnet 5**, **Claude Opus 5** → fill
   the short Anthropic use-case form → Submit. Usually granted within minutes.
3. **Billing → Budgets** → create a monthly cost budget with an email alert
   (~$200 for V1) so AI spend can't run away.
4. In `.env`: `AI_DRIVER=bedrock` (model IDs are already preset in `.env.example`).

## §4 — Reply ingestion + bounces (after §1 is verified)

**Why:** replies landing in the inbox automatically, and bounces/complaints
feeding the suppression list. Claude can't wire these until SES is verified.

- **Inbound replies (SES):** add an **MX record** for a reply subdomain (e.g.
  `reply.yourdomain.com` → `inbound-smtp.us-east-1.amazonaws.com`). Claude then
  creates the SES receipt rule → SNS topic → webhook config with you.
- **Bounces/complaints:** nothing extra to click — Claude sets up the SNS topic
  subscriptions once the keys are in.
- **Gmail senders' replies:** come from the same Google setup in §2, but need the
  `gmail.readonly` scope, which Google treats as *restricted* (security
  assessment). Plan on SES-based reply handling first.

## §5 — Production launch (E10, not needed yet)

- **Hosting (decision D-C):** API + worker host, managed Postgres 16, Redis.
  Web is already on Vercel.
- **Product name + domain (decision D-A):** needed for DNS, SES domain and
  public pages (`apps/web/src/lib/marketing.ts` holds the name).
- **Sentry** (free tier): one DSN for error monitoring (T10.5).
- **Stripe:** not in V1 — beta is free.

---

## When each is done, tell Claude

- **Bedrock model access granted** → Claude flips AI to real Claude and tunes
  prompts against live output (the E6 code is already built on a mock).
- **Google client id/secret in** → Gmail sender (T3.3) is built: Settings →
  Sender accounts → **Connect Gmail**. It also asks for `openid` + `email`
  (non-sensitive) to learn which address was connected. Sheets sync (T2.8) next.
- **AWS keys + domain verified** → Claude wires the SES sender (T3.2), SNS
  bounces, and inbound reply ingestion (§4). Production access unblocks real
  beta sending (the send engine itself is built and tested).

You don't have to wait for all of them — hand Claude whichever lands first and it
wires that piece. **Docker Desktop** must be running for local dev (fixed via
`wsl --update`; if it ever crashes again, same rename-run-dir trick).
