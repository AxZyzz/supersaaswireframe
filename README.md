# Business Lab Outreach — Clickable Prototype

Phase 0 **UI-only** clickable prototype of the AI Outreach Platform, built from `prompt.txt`.
Twenty-CRM design language (Inter, indigo `#3E63DD` accent, hairline borders, compact density).

> **No backend.** Nothing sends email, logs in, or saves data. Every button/link/row/tab
> navigates to a real screen so reviewers can click the whole journey. All data is mock.

## Run it

```bash
npm install      # already done if node_modules/ exists
npm run dev      # opens http://localhost:5173
```

Build a static version: `npm run build` → output in `dist/`.

## Stack

React 18 · Vite · Tailwind CSS · React Router (hash routing) · Recharts · Lucide icons.

## Demo happy path

Landing → Start free → Sign up → Onboarding (Workspace → Sender → Domain → Done) →
Dashboard → Leads → Import → click a lead → Add to campaign → **Build with AI** →
walk the chat → Generate → Summary → **Launch** → confirmation → View campaign (Analytics) →
Inbox → select Anita Sharma → classify "Interested".

Manual path: Campaigns → New → Build manually → Setup → Senders → Template → Sequence → Preview → Launch.

## Tips

- Press **⌘K / Ctrl-K** anywhere in the app for the command palette.
- Collapse the sidebar with the chevron at its bottom.
- Toggle the Leads list between **Table** and **Kanban**.

## Continuation features (prompt2.txt)

Meeting-driven additions layered onto the base, all clickable / non-functional:

1. **AI Business Memory** — onboarding step + `Settings → AI Memory` + "View memory" drawer in the AI builder.
2. **List-first leads** — Leads `All leads / Lists / Segments`, Create-list modal (Sheet/BD/API ongoing sync), `/leads/lists/:id`.
3. **Global sender pool** — `Settings → Sender accounts` pool + per-campaign assignment, human-like ramp, schedule preview.
4. **Reply routing** — same-sender vs central handoff card + BCC tracking (onboarding, settings, inbox source-sender tooltip).
5. **AI reply learning** — inbox confidence %, approval counts, per-category auto-mode (`Settings → AI Memory → Reply rules`).
6. **Event timeline** — `Events` tab on the lead profile + "Recent tracked events" in Analytics.
7. **AI recommendations** — panel + weekly summary on Analytics Overview.
8. **Conversion analytics** — conversion KPI, campaign goal field, Templates conversions, `Settings → Integrations` goal signals.
9. **Signal rules** — `Settings → Signals` + sequence condition options.
10. **White-label / Super SaaS** — `Settings → Brand` SaaS setup + Admin white-label column & workspace drawer.
11. **Usage limits** — Pricing plan limits + `Settings → Billing` meters + campaign usage banner.
12. **Future channels** — roadmap cards (New campaign / Analytics / Settings), disabled with roadmap modal.
13. **Documentation center** — `/docs` with section sidebar, start-here checklist, doc cards, walkthrough drawer; sidebar + top-bar + ⌘K entries.

New routes: `/onboarding/business-memory`, `/leads/lists/:id`, `/docs`, and `/settings?tab=ai-memory|senders|brand|billing|integrations|signals`.

## Screen map (26 base)

`/` `/pricing` `/signup` `/login` ·
`/onboarding/{workspace,sender,domain,done}` ·
`/dashboard` · `/leads` `/leads/import` `/leads/:id` ·
`/campaigns` `/campaigns/new` `/campaigns/new/{setup,senders,template,sequence,preview}`
`/campaigns/launched` `/campaigns/new/ai` `/campaigns/new/ai/summary` `/campaigns/:id` ·
`/templates` `/templates/editor` · `/inbox` · `/analytics` · `/settings` · `/admin`

## Structure

```
src/
  components/   AppShell, Sidebar/TopBar, CommandMenu, OnboardingShell, ManualStepper,
                ImportLeadsModal, Public nav/footer, ui.jsx (Button/Tag/Card/Table/...)
  pages/        one file per screen (manual/ and ai/ subfolders for the builder flows)
  data/mock.js  single placeholder-data bank reused everywhere
```
