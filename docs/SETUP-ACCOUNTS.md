# Account Setup — Aman's Homework (E0: T0.3–T0.6 + Docker)

These need a human with payment methods / phone verification. Claude cannot create accounts or
enter credentials — do these yourself, then put values in `.env` (never commit it).

## 0. Docker Desktop (blocks local dev DB)
- [ ] Install Docker Desktop for Windows: https://www.docker.com/products/docker-desktop/
- [ ] Enable WSL2 backend when prompted; restart if asked
- [ ] Verify: `docker compose version` in a terminal
- [ ] Then in repo root: `npm run db:up`

## 1. AWS account (T0.3)
- [ ] Create AWS account under A2B (a2b.business.official@gmail.com or dedicated alias)
- [ ] Enable MFA on root; create IAM admin user for daily use
- [ ] Set a billing alarm (e.g. alert at $20, $50)
- [ ] Pick region with SES + SES inbound receiving support — **us-east-1 recommended** (inbound receiving is limited to few regions; us-east-1 safest)
- [ ] Create IAM user/key for the app: SES send, SNS, S3 — put keys in `.env`

## 2. SES production access (T0.4) — **2-week lead time, do first**
- [ ] Verify sending domain in SES (needs the product domain — decide D-A name first, or use a temp subdomain of an owned domain)
- [ ] Enable DKIM (Easy DKIM), add DNS records
- [ ] Request production access (exit sandbox): SES console → Account dashboard → Request production access. Use case: transactional + marketing outreach platform, describe bounce/complaint handling (SNS webhooks, suppression list — already in the V1 plan)
- [ ] Request sending-limit increase once out of sandbox

## 3. Google Cloud project (T0.5)
- [ ] Create project `supersaas` under A2B Google account
- [ ] Enable APIs: Gmail API, Google Sheets API, Google Drive API (Sheets picker needs it)
- [ ] OAuth consent screen: External, add scopes `gmail.send`, `spreadsheets.readonly`, `drive.metadata.readonly`; add yourself as test user
- [ ] Create OAuth client (Web), redirect URL `http://localhost:4000/auth/google/callback` for dev
- [ ] Put client ID/secret in `.env`
- **Testing-mode trap:** "Testing" publishing status = 100 test users AND **refresh tokens expire
  every 7 days** — connected Gmail senders die weekly. Fine for solo dev, NOT for real beta users.
  Before beta users connect Gmail, publish to "In production" and start Google's restricted-scope
  (`gmail.send`) verification — lead time is **weeks** (possibly CASA security assessment), so kick
  it off alongside the SES request, not at public launch.
- Later (E5/E7): unified inbox needs `gmail.readonly` or `gmail.modify` scope added for reply
  ingestion from Gmail senders — plan the scope list before filing verification.

## 4. Anthropic API key (T0.6)
- [ ] Create key at console.anthropic.com under A2B org
- [ ] Set monthly spend cap (~$200 budgeted for V1)
- [ ] Put in `.env` as `ANTHROPIC_API_KEY`

## Later (E10, not now)
- Production domain + Cloudflare DNS
- Vercel account for web deploy
- Sentry account (free tier)
