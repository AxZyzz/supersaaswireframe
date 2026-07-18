# AI Outreach Platform — Wireframe Summary

**Prepared by:** A2B AI Technologies | **For:** Yakin Shah / Business Lab | **Date:** June 2026

This document is a quick reference for anyone reviewing the clickable wireframe prototype. The prototype is designed to validate the user experience and screen flow before development begins.

**All data shown in the prototype is fictional.** Names, emails, companies, numbers, charts, and metrics are placeholder content used to make the screens feel realistic. No real emails are sent, no real data is saved, and no real login occurs.

## What's Included in the Wireframe

**Public Pages** — Landing page with product overview, a Pricing page with three plans (Starter, Growth, Scale), Sign Up and Log In screens. Pricing values shown are illustrative and not final. Payment or checkout is not implemented.

**Onboarding (4 steps)** — Workspace setup, AI Business Memory (teach the AI about your business), Sender email connection, and Domain readiness check (SPF/DKIM/DMARC). All forms are visual only and do not save.

**Dashboard** — Summary view with stat cards (total leads, active campaigns, emails sent, reply rate), a campaign status table, recent activity feed, alerts, and quick action buttons.

**Lead Management** — A searchable, filterable lead table with 10 sample leads. Supports Table and Kanban views. Includes a Lists view (with sync status for Google Sheet, Brilliant Directories, API sources), a Segments view, and a lead import modal (CSV, Google Sheet, REST API, Brilliant Directories tabs). Each lead has a detailed profile page with timeline, emails, events, notes, and tasks.

**Campaign Builder** — Two creation modes: AI-assisted (a guided chat that drafts a full email sequence from a few questions) and Manual (a 5-step wizard: Setup → Senders → Template Editor → Sequence Builder → Preview & Launch). The AI builder is the centerpiece of the demo. A launch confirmation screen is shown after both paths.

**Templates Library** — A collection of five sample email templates with an editor that supports personalization variables and a live preview pane.

**Unified Inbox** — A three-pane email client layout with a conversation list, thread view, and lead context panel. Includes AI-drafted reply suggestions with confidence scoring, reply classification (Interested, Not interested, Question, Out of office, etc.), and an auto-reply learning flow.

**Analytics** — Five tabs: Overview (KPI cards, charts, AI recommendations, weekly summary), Campaigns (performance table with sparklines), Templates (usage and conversion comparison), Lead Sources (donut chart and table), and Follow-ups (performance by sequence step). Also serves as the campaign detail view.

**Settings** — Eight sections: Workspace config, AI Memory & Reply Rules, Global Sender Pool with ramp-up and reply routing, Team management, Brand / White-label setup (preview your own branded login, dashboard, and email footer), Billing with usage meters, Integrations (conversion goal signals and REST API endpoints), and Signal Rules (automated actions triggered by external events).

**Admin Panel** — An operator-level dashboard showing platform-wide stats, a workspaces table (with white-label status column), system health indicators, sending activity chart, and an error log.

**Documentation Center** — An in-app help center with a section sidebar, a start-here checklist, documentation cards, and a guided walkthrough drawer.

**App Shell** — A persistent left sidebar with navigation, workspace switcher, favorites, and user profile. A top bar with breadcrumbs, contextual actions, and a notifications bell. A ⌘K command palette for quick navigation across all screens.

## What's Not Implemented

- No real authentication — Sign Up and Log In buttons simply navigate to the next screen
- No real email sending — campaign launch is visual only
- No payment or checkout — pricing buttons navigate to Sign Up
- No data persistence — forms do not save; refreshing resets everything
- No API connections — import, sync, and integration screens are mock UIs
- Future channels (SMS, WhatsApp, LinkedIn) appear as disabled roadmap cards

## Recommended Demo Flow

Landing → Sign Up → Onboarding → Dashboard → Leads → Import Leads → Lead Profile → New Campaign → AI Builder → AI Summary → Launch → Analytics → Inbox → Classify a Reply

*For questions or feedback, please contact the A2B team directly.*
