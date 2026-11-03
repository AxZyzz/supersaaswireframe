# SuperSaaS (working title)

AI-powered cold-email outreach platform by A2B AI Technologies. Lead import (CSV / Google Sheets /
REST API), manual + AI campaign builder, sending engine with rotation & ramp-up (SES / Gmail / SMTP),
unified inbox with AI reply classification, analytics, white-label-ready multi-tenant architecture.

## Monorepo layout

| Path | What |
|------|------|
| `apps/api` | NestJS backend (PostgreSQL + RLS, Redis/BullMQ, Socket.io) |
| `apps/web` | Next.js frontend |
| `apps/wireframe` | Phase 0 clickable prototype (React/Vite) — reference only, not shipped |
| `packages/shared` | Shared TypeScript types/constants |

## Getting started

```bash
npm install                 # installs all workspaces
cp .env.example .env        # fill in secrets
npm run db:up               # Postgres + Redis via Docker
npm run dev:api             # NestJS on :4000
npm run dev:web             # Next.js on :3000
npm run dev:wireframe       # Phase 0 prototype (Vite)
```

Account prerequisites (AWS/SES + Bedrock, Google Cloud): see [`docs/SETUP-ACCOUNTS.md`](docs/SETUP-ACCOUNTS.md).

## Status

V1 in progress. Built and tested: leads, campaigns, AI builder, send engine,
inbox, analytics, team/onboarding, operator console, and SMTP + Gmail sending.
Next up: Google Sheets sync (Google credentials are in place). Waiting on
accounts or decisions: SES sending, bounce/complaint webhooks, inbound reply
capture, real Claude via Bedrock, Sentry, hosting. Task-by-task status lives in the A2B vault:
`Company/A2B AI Technologies/Products/SuperSaaS/V1 Task Breakdown.md`.
