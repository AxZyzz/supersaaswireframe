# Compliance checklist (T10.6)

Status of the legal / anti-spam requirements as of 2026-11-02. ✅ done in code ·
🟡 partly / needs a decision · ⬜ open. Not legal advice; get the legal pages
reviewed before general availability.

## CAN-SPAM (US) — commercial email

| Requirement | Status | Where |
|---|---|---|
| No false or misleading header info | ✅ | From name/address are the sender's own verified identity |
| No deceptive subject lines | 🟡 | User responsibility, stated in Terms (acceptable use) |
| Identify the message as an ad | 🟡 | User responsibility for B2B outreach; stated in Terms |
| Valid physical postal address in every email | ✅ | `orgs.postal_address`, printed with the workspace name in every campaign footer (`send-render.ts`); dashboard alert until it's set |
| Clear, working opt-out | ✅ | One-click unsubscribe link in every email (`/u/:token`) |
| Honour opt-outs within 10 business days | ✅ | Immediate: suppression list checked before every send |
| Monitor what others do on your behalf | ✅ | Terms make each workspace responsible for its sending |

## Gmail / Yahoo bulk-sender rules (Feb 2024)

| Requirement | Status | Where |
|---|---|---|
| `List-Unsubscribe` + `List-Unsubscribe-Post: One-Click` headers | ✅ | `send.service.ts` |
| SPF + DKIM + DMARC on the sending domain | 🟡 | In-app DNS check + guidance; enforcement needs SES (T3.2) |
| Spam rate < 0.3% | ⬜ | Needs SES complaint webhooks (T5.6) + monitoring |
| Low bounce rate | 🟡 | Daily caps + email limits now; hard-bounce suppression needs SES (T5.6) |

## GDPR / UK GDPR

| Requirement | Status | Where |
|---|---|---|
| Privacy notice | 🟡 | `/privacy`: draft banner until `LEGAL.reviewed`; contact email to fill (`lib/marketing.ts`) |
| Terms of service | 🟡 | `/terms`: same |
| Consent to terms at signup | ✅ | Signup form notice with links |
| Right of access / portability | ✅ | Settings → Data & privacy → Export JSON (`GET /orgs/me/export`) |
| Right to erasure (account) | ✅ | Delete my account (`DELETE /auth/me`, password re-check, last-admin guard) |
| Right to erasure (workspace) | ✅ | Delete workspace (`DELETE /orgs/me`, typed-name confirmation; cascades all data) |
| Erasure request from a contacted person | ✅ | Lead → Forget (`DELETE /leads/:id?forget=true`): deletes data, keeps the address suppressed |
| Data minimisation of exports | ✅ | Export omits password hashes, sender secrets, token hashes |
| Security of processing | ✅ | RLS tenant isolation, encrypted sender creds, hashed passwords, role matrix (`docs/AUTHZ-MATRIX.md`) |
| Processor agreement (DPA) for customers | ⬜ | Needed before GA; customers are controllers of their lead data |
| Sub-processor list | 🟡 | Named in the privacy policy; finalise after hosting decision (D-C) |
| Records of processing / retention policy | ⬜ | Write once infra + backups exist (T10.4) |
| Cookie consent | ✅ | Not required: no analytics/ad cookies; session in localStorage is strictly necessary |

## Before public launch

1. Fill `LEGAL.contactEmail` / `LEGAL.postalAddress` once the product domain is chosen (D-A).
2. Lawyer review of `/privacy` and `/terms`, then set `LEGAL.reviewed = true`.
3. DPA template for customers + final sub-processor list.
4. Wire SES bounce/complaint webhooks (T5.6) so hard bounces and complaints auto-suppress.
