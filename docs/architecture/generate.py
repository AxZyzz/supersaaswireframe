"""Generate the SuperSaaS architecture + status Excalidraw and an SVG preview.

Run:  python docs/architecture/generate.py
Edit the content lists (PUBLIC_PAGES, MODULES, ...) and statuses (D/P/T) when
something changes, then re-run. Open the .excalidraw on excalidraw.com
(File -> Open) or in Obsidian's Excalidraw plugin.
"""
import json
import os
import random
import textwrap
from html import escape

random.seed(42)
OUT_DIR = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(OUT_DIR, "supersaas-architecture.excalidraw")
PREVIEW = os.path.join(OUT_DIR, "supersaas-architecture-preview.svg")

FONT = 5
FS = 24          # box text (dense detail boxes)
FS_HDR = 36      # section headers
FS_TITLE = 48
CHAR = 0.63       # approx glyph width factor for Excalifont
LH = 1.25

STYLE = {
    "done":    ("#d0ebff", "#1971c2", "DONE"),
    "partial": ("#fff3bf", "#f08c00", "PARTIAL"),
    "todo":    ("#ffc9c9", "#e03131", "NOT DONE"),
    "actor":   ("#f1f3f5", "#495057", None),
    "note":    ("#e5dbff", "#7048e8", None),
}

ELS = []
BY_ID = {}
_n = [0]


def nid(p):
    _n[0] += 1
    return f"{p}_{_n[0]}"


def common(t, x, y, w, h, stroke, bg, **kw):
    e = {
        "id": kw.pop("id", nid(t[:3])), "type": t, "x": x, "y": y,
        "width": w, "height": h, "angle": 0, "strokeColor": stroke,
        "backgroundColor": bg, "fillStyle": "solid", "strokeWidth": 2,
        "strokeStyle": "solid", "roughness": 1, "opacity": 100,
        "groupIds": [], "frameId": None, "roundness": {"type": 3},
        "seed": random.randint(1, 2**31), "version": 1,
        "versionNonce": random.randint(1, 2**31), "isDeleted": False,
        "boundElements": [], "updated": 1763510400000, "link": None,
        "locked": False,
    }
    e.update(kw)
    return e


def add(e, at=None):
    if at is None:
        ELS.append(e)
    else:
        ELS.insert(at, e)
    BY_ID[e["id"]] = e
    return e


def wrap(text, width, fs):
    maxc = max(10, int((width - 28) / (fs * CHAR)))
    out = []
    for line in text.split("\n"):
        ind = "  " if line.startswith("- ") else ""
        out += textwrap.wrap(line, maxc, subsequent_indent=ind) or [""]
    return out


def text_el(x, y, s, fs=FS, color="#1e1e1e", container=None, w=None, h=None,
            align="left", valign="top", original=None):
    lines = s.split("\n")
    w = w or max(len(l) for l in lines) * fs * CHAR
    h = h or len(lines) * fs * LH
    return add(common("text", x, y, w, h, color, "transparent",
                      roundness=None, text=s, fontSize=fs, fontFamily=FONT,
                      textAlign=align, verticalAlign=valign,
                      containerId=container, originalText=original or s,
                      autoResize=container is None, lineHeight=LH))


def box(x, y, w, body, status, fs=FS, h=None, align="left"):
    bg, stroke, tag = STYLE[status]
    lines = wrap(body, w, fs)
    first, _, rest = body.partition("\n")
    original = (f"{first}   [{tag}]" if tag else first) + ("\n" + rest if rest else "")
    if tag:
        lines[0] = f"{lines[0]}   [{tag}]" if len(lines[0]) + len(tag) + 5 <= int((w - 28) / (fs * CHAR)) else lines[0]
        if f"[{tag}]" not in lines[0]:
            lines.insert(1, f"[{tag}]")
    th = len(lines) * fs * LH
    h = h or th + 32
    r = add(common("rectangle", x, y, w, h, stroke, bg))
    t = text_el(x + 14, y + (h - th) / 2, "\n".join(lines), fs=fs,
                container=r["id"], w=w - 28, h=th, align=align,
                valign="middle", original=original)
    r["boundElements"].append({"type": "text", "id": t["id"]})
    return r, h


def box_height(w, body, status, fs=FS):
    lines = wrap(body, w, fs)
    tag = STYLE[status][2]
    extra = 0
    if tag and len(lines[0]) + len(tag) + 5 > int((w - 28) / (fs * CHAR)):
        extra = 1
    return (len(lines) + extra) * fs * LH + 32


def section(x, y, w, title, items, cols, stroke="#1e1e1e", gap=40, pad=36,
            fill="transparent", dashed=True, fs_hdr=FS_HDR):
    """Masonry layout of (body, status) items in a dashed container."""
    idx = len(ELS)
    hdr_h = fs_hdr * LH + 30
    colw = (w - 2 * pad - (cols - 1) * gap) / cols
    tops = [y + hdr_h + pad / 2] * cols
    for body, status in items:
        c = min(range(cols), key=lambda i: tops[i])
        _, h = box(x + pad + c * (colw + gap), tops[c], colw, body, status)
        tops[c] += h + gap
    H = max(tops) - y - gap + pad
    cont = common("rectangle", x, y, w, H, stroke, fill,
                  strokeStyle="dashed" if dashed else "solid", strokeWidth=2)
    add(cont, at=idx)
    text_el(x + 24, y + 16, title, fs=fs_hdr, color=stroke)
    return cont, H


def frame(x, y, w, h, title, color, at):
    f = common("rectangle", x, y, w, h, color, "transparent", strokeWidth=4)
    add(f, at=at)
    text_el(x + 30, y + 20, title, fs=44, color=color)
    return f


def arrow(src, dst, x1, y1, x2, y2, label=None, color="#1e1e1e", dashed=False,
          lx=None, ly=None):
    a = add(common("arrow", x1, y1, x2 - x1, y2 - y1, color, "transparent",
                   roundness={"type": 2}, points=[[0, 0], [x2 - x1, y2 - y1]],
                   startBinding={"elementId": src["id"], "focus": 0, "gap": 6},
                   endBinding={"elementId": dst["id"], "focus": 0, "gap": 6},
                   startArrowhead=None, endArrowhead="arrow",
                   strokeStyle="dashed" if dashed else "solid",
                   lastCommittedPoint=None, elbowed=False))
    src["boundElements"].append({"type": "arrow", "id": a["id"]})
    dst["boundElements"].append({"type": "arrow", "id": a["id"]})
    if label:
        text_el(lx if lx is not None else x1 + 20,
                ly if ly is not None else (y1 + y2) / 2 - 14,
                label, fs=22, color="#495057")
    return a


# ---------------------------------------------------------------- content
X0, W = 100, 5600
D, P, T, A, N = "done", "partial", "todo", "actor", "note"

ACTORS = [
    ("Workspace users\nAdmin / Manager / Agent. Every route checks the role (docs/AUTHZ-MATRIX.md). One person can belong to several workspaces and switch.", A),
    ("A2B operator (staff)\nUses /operator across all workspaces. Granted only from the CLI: npm run operator -w apps/api -- grant <email>.", A),
    ("Website visitor\nSees landing + pricing; joins the waitlist when SIGNUP_MODE=waitlist (invite-only beta).", A),
    ("Lead / email recipient\nGets campaign emails in Gmail/Outlook; opens, clicks, unsubscribes, replies or bounces.", A),
    ("External system\nCRM, form or Zapier pushing leads with POST /v1/leads + X-Api-Key.", A),
]

PUBLIC_PAGES = [
    ("Landing  /\nHero, features, CTA. Waitlist form when sign-up is invite-only.", D),
    ("Pricing  /pricing\nBeta = free. Planned $29-$199 tiers shown only with SHOW_PLANNED_TIERS.", D),
    ("Privacy  /privacy  +  Terms  /terms\nDraft pages exist. Need: company name + domain (decision D-A), postal address, legal review, customer DPA, sub-processor list.", P),
    ("Sign up  /signup\nCreates user + workspace + admin membership; seeds 5 tags + 5 starter templates. Invite-only in waitlist mode.\nEmail verification at sign-up: NOT built.", D),
    ("Login  /login\nEmail + password (bcrypt 12, constant-time for unknown emails), per-IP throttling. httpOnly refresh cookie + in-memory access token. Org switcher.", D),
    ("Forgot / reset password\n/forgot-password, /reset-password: single-use hashed token, expiry, revokes all sessions. Built + tested, but the email only goes out once SYSTEM_SMTP_* works (Gmail app password rejected, 535). Locally the link is printed in the API log.", P),
    ("Invite  /invite/[token]\nSingle-use link bound to the invited email; works for existing and new users.", D),
    ("Onboarding wizard  /onboarding\nWorkspace -> business knowledge -> connect sender -> DNS check -> done. Every step skippable.", D),
]

APP_PAGES = [
    ("Dashboard  /dashboard\nLead / campaign / send counts with 7-day deltas, engagement, activity feed, sender alerts, 'Start here' checklist.", D),
    ("Leads  /leads\n- Search, filters (status, score, source, tag), sort, pagination\n- Table + kanban (drag to change status)\n- Bulk tag, CSV export (formula-safe)\n- Import modal: CSV / XLSX <=10 MB, column mapping with auto-guess, skip or update duplicates, per-row error report\n- Duplicates modal: detect + merge", D),
    ("Lead profile  /leads/[id]\nInline-edit details, activity timeline (sent, opened, replied...), notes, tags, Forget (GDPR erase + suppress).", D),
    ("Segments  /segments, /segments/[id]\nManual lists + smart rule builder (all/any): status, score, source, company, email, tags, created within N days, engagement (emailed, opened, clicked, replied, no reply...). Membership materialised by a worker.\nKnown bug: invalid tag id -> refresh fails silently.", D),
    ("Templates  /templates\nFolders, visual editor + raw HTML mode, {variable|fallback} chips, preview with sample or real lead (sanitised), test-send, duplicate.", D),
    ("Campaigns  /campaigns\n- 4-step wizard: Setup -> Sequence -> Senders -> Review\n- Steps: template, delay, condition (always / opened-no-reply / not-opened), A/B subject variants\n- AI builder: brief -> sequence -> 'Ask AI to edit' with undo -> draft campaign\n- Launch now / schedule, pause, resume, duplicate, archive, live stats", D),
    ("A/B auto-winner (in Campaigns)\nSpec: weekly score (open 0.3 + reply 0.5 + click 0.2), double top variants, halve/remove bottom ones. Only even round-robin A/B is built.", T),
    ("Inbox  /inbox\n- 3 panes: list, thread (sent + replies + notes), lead context\n- Filters: classification, unread, open/closed, campaign, activity range\n- Assign, reclassify, convert, close, internal notes\n- Reply to lead (threaded In-Reply-To)\n- Draft / Rewrite with AI (never auto-sent)\n- Live via Socket.io, unread badge\n- Sync Gmail button + Test reply", D),
    ("Analytics  /analytics\nDate ranges (7/30/90/all/custom), funnel, campaign table per step + per A/B variant, template performance, lead-source funnel, CSV + Save-as-PDF.\nOpen/click numbers stay 0 until tracking has a public URL.", D),
    ("Settings  /settings\n- Workspace profile + branding (logo, brand colour app-wide)\n- Team: invites, roles, remove\n- Senders: Gmail / SMTP, verify, test, DNS check, warm-up, daily limit, window; edit name / reply-to / signature*\n- API keys, Knowledge base, Lead statuses\n- Notification prefs (in-app + email), Integrations (Gmail, Sheets)\n- Usage / plan meter, Data & privacy (export, delete)\n* google-stack only", D),
    ("Help  /help\n13 articles with search, contextual '?' links on pages.", D),
    ("Operator console  /operator (A2B staff)\nWorkspaces, plan beta/internal, failures, queue + system health, uptime, waitlist approve -> invite link, feedback, Pause sending (needs a reason, notifies members).", D),
]

SHARED_UI = [
    ("App shell\nSidebar, Ctrl/Cmd+K command palette, notification bell (deep links), theme toggle (system/light/dark, no flash), feedback button, error boundary + 404.", D),
    ("API client  lib/api.ts\nAccess token kept in memory only; silent refresh through the httpOnly cookie; one error helper. Talks to NEXT_PUBLIC_API_URL (default :4000).", D),
    ("Realtime client  lib/realtime.ts\nSocket.io (websocket transport only) -> live inbox + notifications.", D),
    ("Stack\nNext.js 16.4.2 (App Router, Turbopack), React 19.2.9, Tailwind v4, runtime brand colour. Port 3000.", D),
    ("Next.js upgrade\nA newer moderate advisory on 16.4.2 is not yet addressed.", T),
]

LANE = [
    ("Tracking + unsubscribe\nGET /t/o/:id open pixel, GET /t/c/:id click redirect (HMAC-signed), GET/POST /u/:id unsubscribe.\nCode done; on localhost recipients can't reach it -> needs public HTTPS API_URL.", P),
    ("Public REST API\nPOST /v1/leads with X-Api-Key: create or upsert. Keys SHA-256 hashed, shown once, per-key requests/min limit (429 + Retry-After).", D),
    ("Google OAuth callback\nGET /auth/google/callback for Connect Gmail and Connect Sheets (browser-bound state).", D),
    ("Health\nGET /  and  GET /health/ready (DB + Redis, 503 when down).", D),
]

CROSS = [
    ("Auth + roles\nJWT access token + rotating refresh token (httpOnly cookie, revoked on logout). RolesGuard admin / manager / agent; operator flag.", D),
    ("Tenant isolation\nPostgres RLS ENABLE + FORCE on every tenant table; app connects as restricted supersaas_app; withOrgContext sets app.current_org_id; SECURITY DEFINER functions for cross-tenant scans.", D),
    ("Rate limiting\nRedis throttler (throttle:* keys): per-IP login, signup, waitlist, per-API-key RPM.\nPer-account login throttling: not built.", D),
    ("Input + secrets safety\nGlobal ValidationPipe (whitelist), AES-256-GCM for sender secrets, SSRF guard on SMTP hosts, HTML sanitiser, Swagger /docs dev-only.", D),
    ("Plan limits  usage/plan-limits.ts\nLeads, campaigns, steps, senders, seats, emails per day/month, AI generations. 403 LIMIT_REACHED. 'internal' plan unlimited.", D),
]

MODULES = [
    ("auth\nsignup, login, logout, refresh, me, switch-org, forgot / reset password, delete account, Google OAuth callback.", D),
    ("orgs\nWorkspace profile + branding, members + roles (last-admin protection), invites, onboarding, setup checklist, JSON export, delete workspace.", D),
    ("leads + tags + lead-statuses + api-keys + v1\nCRUD, import job (queue), duplicates + merge, CSV export, notes, bulk tags, custom statuses (6 locked system ones), hashed API keys.", D),
    ("segments\nManual + smart segments, materialised membership, refresh worker.", D),
    ("templates\nFolders, preview, test-send, duplicate; 5 starter templates per workspace.", D),
    ("campaigns\nCRUD, steps, A/B variants, enroll audience, schedule / pause / resume / duplicate / archive, stats. Per-lead state machine (campaign_leads): step, status, stop reason, next send time.", D),
    ("sending engine\n30 s tick finds due sends (definer fn) then works per tenant: send window, daily limit, warm-up 20/50/100 per day, plan caps (defer, not drop), suppression, verified-only senders. Render: variables, tracked links, pixel, unsubscribe footer, List-Unsubscribe one-click. Network call outside the DB transaction. Gmail auth failure -> retry in 15 min.", D),
    ("tracking  (/t, /u)\nOpen pixel, signed click redirect, bot filter (no UA, scanners, <10 s after send), unsubscribe confirm page then POST. Works in tests; live needs public URL.", P),
    ("senders\nProviders: Gmail OAuth (gmail.send, optional gmail.readonly), SMTP (verify, test, encrypted password), SES (stub only). SPF/DMARC DNS check, warm-up ramp, auto-verify on add, name / reply-to / signature edit*.", D),
    ("inbox\nConversations, threads, notes, assign, reclassify, convert, threaded reply, simulate-reply (dev). Stop-on-reply; out-of-office -> next step +3 days; not-interested -> stop + tag.", D),
    ("Gmail reply sync*  (T5.7)\nEvery 2 min + 'Sync Gmail'. Replies from emailed leads -> inbox (quote-stripped, AI-classified, sequence stopped). mailer-daemon bounces -> suppression. Personal mail ignored (only its Gmail id kept). Built + 4 tests; needs Gmail reconnect with read permission + live test.", P),
    ("ai\nKnowledge base, generate-sequence, from-sequence, refine ('Ask AI to edit'), reply-draft, reply classification. ai_usage log, 30 generations/month on beta. AI_DRIVER = mock | bedrock | gemini*. Eval harness: 25 replies + 5 briefs.", D),
    ("analytics\nOverview, campaigns, steps + variants, templates, sources, CSV export. Live queries (no roll-ups yet).", D),
    ("notifications\nIn-app list / read / prefs. Email delivery every minute + Monday weekly summary through the system mailer: waits on SYSTEM_SMTP.", P),
    ("integrations / Google Sheets\nConnect (spreadsheets.readonly), preview, map columns, import, Sync now, hourly re-sync, disconnect. Not yet tested with a real sheet.", P),
    ("operator + beta + waitlist + feedback\nCross-tenant console APIs, plan switch, pause sending, waitlist approve -> invite, feedback inbox.", D),
    ("realtime gateway\nSocket.io /realtime, per-org rooms, Redis adapter so several API instances fan out.", D),
    ("mail (system mailer)\nPlatform's own mail: resets, notifications, weekly summary via SYSTEM_SMTP_*. Unset -> printed to the API log. Current Gmail app password rejected (535), parked.", P),
]

ASYNC = [
    ("Queue: lead-import\nCSV / XLSX import worker: mapping, dedupe (case-insensitive email), per-row errors.", D),
    ("Queue: segment-refresh\nRe-materialises smart segment membership.", D),
    ("Queue: campaign-send\nRepeatable 30 s scheduler tick -> sending engine.", D),
    ("Queue: system-jobs (one shared Redis schedule)\n- notification-emails: every 1 min\n- weekly-summary: Mon 08:00 UTC\n- sheet-sync: every 15 min (each sheet hourly)\n- gmail-reply-sync*: every 2 min\nJOBS_SCHEDULER=off on extra instances.", D),
    ("Test isolation\nQUEUE_PREFIX per test process so a running dev API can't steal test jobs.", D),
    ("Daily analytics roll-up worker (T8.1)\nDeferred by design: live queries are fine at beta scale.", T),
]

DATA = [
    ("PostgreSQL 16  (port 5432)\n46 migrations (0000-0045), run by drizzle-kit as the owner role. RLS on every tenant table.\nTables: orgs, users, memberships, invites, password_resets, refresh_tokens, leads, tags, lead_tags, lead_notes, lead_events, segments, segment_members, import_jobs, sender_accounts, api_keys, template_folders, templates, campaigns, campaign_steps, campaign_leads, sent_emails, email_events, suppression_list, conversations, conversation_messages, conversation_notes, notifications, ai_usage, org_knowledge, integrations, sheet_syncs, gmail_seen_messages ...", D),
    ("Redis 7  (port 6379)\nBullMQ queues + repeatable schedules, rate-limit counters, Socket.io adapter pub/sub. Losing Redis loses queued jobs, not data.", D),
    ("Object storage (S3 / GCS)\nDurable storage for import files (T2.5). Today the upload is handled in-process.", T),
    ("Automated backups\npg_dump / restore steps are in RUNBOOK.md; nothing scheduled yet (no host).", T),
]

EXTERNAL = [
    ("Gmail API: send\nOAuth sender, token AES-encrypted, live-verified with Aman's Gmail.", D),
    ("Gmail API: read*\ngmail.readonly for replies + bounces. Restricted scope: Testing mode needs test users; public launch needs Google verification.", P),
    ("Workspace SMTP servers\nAny mailbox (port 25/465/587/2525) as a sender.", D),
    ("Google Sheets API\nRead-only lead sync; not yet tried on a real sheet.", P),
    ("Google Gemini API*\ngemini-3.5-flash-lite on all tiers, fallback model on 503/504/timeout, 45 s timeout. Live: classification 24/25, builder ~8 s, drafts 1-6 s.", D),
    ("AWS Bedrock (Claude) - main path\nProvider built + tested with mocks; never run for real (no AWS account yet, ~$200 budget planned).", P),
    ("AWS SES sending\nOnly a stub. Needs AWS account, domain verification, production access (~2-week wait).", T),
    ("SES -> SNS bounce / complaint webhooks\n(T5.6) feed suppression automatically.", T),
    ("SES inbound replies (MX)\nReply capture for non-Gmail senders.", T),
    ("System SMTP mailbox\nFor resets + notifications. Configured but login rejected (535): parked.", P),
    ("Sentry (web + API)\nError tracking; needs account / DSN.", T),
    ("Outlook sender / Stripe billing\nDeferred by design.", T),
]

INFRA = [
    ("Local dev\nDocker Compose (supersaas-postgres, supersaas-redis), npm workspaces, ports 3000 / 4000. Guide: docs/RUNNING-LOCALLY.md.", D),
    ("GitHub repo (private)\nAxZyzz/supersaaswireframe. Branches: main (Bedrock), google-stack (Gemini + Gmail read), cloud-session (kept).", D),
    ("CI: GitHub Actions\nOn main: npm audit, migrate, lint, ~293 API tests, build, Playwright E2E.", D),
    ("Uptime probe workflow\nEvery 30 min; idle until repo variable UPTIME_URL is set.", P),
    ("Public HTTPS API_URL\nCloudflare tunnel now or real hosting. Needed for opens, clicks, unsubscribe, and so emails don't look spammy.", T),
    ("Web hosting: Vercel\nFine for apps/web (decision D-C open).", T),
    ("API + workers hosting\nNot Vercel (long-running workers, 30 s ticks, websockets). Cloud Run (min instances), Railway, Render, Fly or a VPS behind Caddy.", T),
    ("Managed Postgres + Redis\nNeon / Supabase / RDS + Upstash; private networking, Redis TLS + password.", T),
    ("Domain + DNS\nName decision D-A, then SPF / DKIM / DMARC, app + api subdomains.", T),
    ("Prod secrets + env management\nPer-environment .env, key rotation plan.", T),
]

WORKFLOWS = [
    ("1. Onboard", [
        ("Sign up\nuser + workspace + seeds", D),
        ("Onboarding wizard\nknowledge base", D),
        ("Connect Gmail or SMTP\nencrypted creds", D),
        ("Auto-verify + DNS check\nSPF / DMARC", D),
        ("Ready to send\nverified sender", D),
    ]),
    ("2. Lead intake", [
        ("CSV / XLSX upload\nor Google Sheet* or\nPOST /v1/leads", D),
        ("lead-import queue\nworker", D),
        ("Map columns, dedupe\nper-row errors", D),
        ("leads + lead_events\nin Postgres (RLS)", D),
        ("Smart segments\nrefresh", D),
    ]),
    ("3. Campaign send", [
        ("Build: wizard or\nAI builder", D),
        ("Enroll segment / leads\nschedule", D),
        ("30 s tick finds due\ncampaign_leads", D),
        ("Checks: window, warm-up,\ncaps, suppression,\nverified sender", D),
        ("Render + tracking\nlinks + unsubscribe", D),
        ("Send via Gmail / SMTP\n(SES not built)", D),
        ("sent_emails + events\nnext step scheduled", D),
    ]),
    ("4. Opens + clicks", [
        ("Recipient opens /\nclicks", P),
        ("/t/o pixel, /t/c\nredirect (needs\npublic API_URL)", P),
        ("Bot filter", D),
        ("email_events", D),
        ("Step conditions +\nanalytics", D),
    ]),
    ("5. Reply", [
        ("Lead replies in Gmail", P),
        ("gmail-reply-sync*\n(2 min) or Sync Gmail", P),
        ("Match an address we\nemailed, strip quotes", D),
        ("AI classifies\n(interested, OOO ...)", D),
        ("Stop sequence / OOO\n+3 days / tag", D),
        ("Inbox + notification\n+ realtime push", D),
    ]),
    ("6. Bounce", [
        ("mailer-daemon\nbounce in Gmail", P),
        ("gmail-reply-sync*", P),
        ("Suppress 'bounced'\nstop sequences", D),
        ("Bounce event +\nlead timeline", D),
        ("SES / SNS bounce\npath", T),
    ]),
    ("7. Password reset", [
        ("Forgot password\n(same answer always)", D),
        ("Hashed single-use\ntoken", D),
        ("System mailer\n(SYSTEM_SMTP, 535)", P),
        ("Email link", P),
        ("New password,\nsessions revoked", D),
    ]),
]

PENDING = [
    ("Needs Aman's accounts / actions\n- Fix system SMTP login (535) -> test reset + notification email\n- Reconnect Gmail with read permission; add Gmail addresses as test users in Google Cloud; live-test reply sync\n- Try a real Google Sheet import + Sync now\n- Public HTTPS URL (cloudflared tunnel) -> re-test opens/clicks\n- AWS account -> file SES request first (2 weeks), Bedrock access (~$200)\n- Sentry DSN; set UPTIME_URL", T),
    ("Decisions waiting\n- D-A product name + domain (blocks legal pages, DNS)\n- D-B target market\n- D-C hosting (then deploy T10.4)\n- D-D beta size + channel\n- Email verification at sign-up\n- Legal review of /privacy + /terms, DPA, sub-processors\n- Merge google-stack into main? (Gemini, reply sync, sender edit)", P),
    ("Security before public launch\n- 2FA for admins + managers\n- Per-account login throttling\n- Email verification at sign-up\n- Private DB/Redis networking, Redis TLS + password\n- Least-privilege AWS IAM\n- Audit log of sensitive actions\n- Encryption-key rotation plan\n- Dependabot + NestJS 12 upgrade, Next.js advisory\n- Strict CSP with nonces", T),
    ("Code gaps found\n- Smart segment with invalid tag id fails silently\n- E2E gaps: add campaign step, add leads to segment, Sheets screens\n- AI emails come back as one paragraph; a {first_name} without fallback seen once\n- Restricted-scope Google verification for gmail.readonly", P),
    ("Launch sequence\nT10.1 acceptance with a real send + reply -> T10.3 deliverability check (seed inboxes, spam score, DKIM alignment) -> T10.4 production deploy -> T10.7 first beta users", T),
    ("Deferred by design\nT8.1 roll-ups, Outlook sender, Stripe billing, WhatsApp / SMS / LinkedIn, warm-up network, custom-domain white-label, Elasticsearch, Datadog, fully automatic AI replies, A/B auto-winner.", T),
]

NOTES = [
    ("Trade-off: one API process runs HTTP, websockets and every worker. Simple to run and deploy today; split workers into their own service when send volume grows (JOBS_SCHEDULER=off on extra web instances).", N),
    ("Bottleneck: tracking, click and unsubscribe links point at API_URL. On localhost no open/click is ever recorded and emails look spammy. Fix = public HTTPS URL (tunnel or hosting).", N),
    ("Trade-off: Postgres RLS isolates tenants even if a query forgets WHERE org_id. Cost: a SET per transaction and SECURITY DEFINER functions for the few cross-tenant scans (scheduler, reply sync).", N),
    ("Scale: schedules live in Redis and Socket.io uses the Redis adapter, so the API can run as several instances behind a load balancer (websocket transport only, no sticky sessions needed).", N),
    ("Why: AI behind one provider seam (AI_DRIVER mock | bedrock | gemini). Bedrock stays the main path; Gemini lives on google-stack to test with real AI until AWS is ready. Mock keeps tests offline.", N),
    ("CAP: CP. Single Postgres primary, strong consistency for sends and suppression (never email someone who unsubscribed). Redis holds only jobs + counters, so losing it delays work but loses no data.", N),
]

# ---------------------------------------------------------------- layout
y = 60
text_el(X0, y, "SuperSaaS - complete architecture + build status", fs=FS_TITLE)
text_el(X0, y + 72,
        "AI cold-email outreach platform by A2B AI Technologies  |  monorepo: apps/api (NestJS 11) + apps/web (Next.js 16) + Postgres 16 + Redis 7\n"
        "Status as of 2026-11-19  |  repo AxZyzz/supersaaswireframe  |  read top -> bottom: 1 users, 2 frontend, 3 backend, 4 data, 5 external services, 6 infrastructure, 7 workflows, 8 pending, 9 design notes",
        fs=28, color="#868e96")

# legend (top right)
lx, ly, lw = X0 + W - 1900, y + 170, 1900
leg_items = [("DONE: built, tested, working", D), ("PARTIAL: built but waiting on an account, a public URL or a live test", P),
             ("NOT DONE: not built yet / needs account / deferred", T),
             ("Grey = who uses it (no status)", A), ("Purple = design note / trade-off", N)]
legend_box = add(common("rectangle", lx, ly, lw, 470, "#1e1e1e", "#ffffff"))
text_el(lx + 24, ly + 16, "Legend", fs=FS_HDR)
yy = ly + 80
for label, st in leg_items:
    bg, stroke, _ = STYLE[st]
    add(common("rectangle", lx + 30, yy, 70, 44, stroke, bg))
    text_el(lx + 120, yy + 6, label, fs=26)
    yy += 60
text_el(lx + 30, yy + 4, "*  = exists on branch google-stack only (not yet merged to main)", fs=26, color="#c2255c")

# branch + how-to-read note (top left)
note_w = W - lw - 60
_, nh = box(X0, ly, note_w,
            "How to read this\nEach box is one page, module, service or step, filled by status (legend, right). Dashed boxes group a layer. "
            "Solid arrows = synchronous requests; dashed = async / external traffic.\n\n"
            "Branches: main = stable, real AI through AWS Bedrock. google-stack = main + Gemini AI provider, Gmail reply + bounce reading, "
            "and sender name / reply-to / signature editing (marked *). Explanation: docs/architecture/README.md. Run it: docs/RUNNING-LOCALLY.md.",
            N, fs=26)
y = ly + max(470, nh) + 80

# 1 users
actors, ah = section(X0, y, W, "1 - WHO USES IT", ACTORS, 5, stroke="#495057")
y_act_bottom = y + ah
y += ah + 200

# 2 frontend frame + lane
LANE_W = 760
WF = W - LANE_W - 60
fr_idx = len(ELS)
fy = y
inner_y = y + 110
s2a, h = section(X0 + 40, inner_y, WF - 80, "2a - Public + auth pages (no login)", PUBLIC_PAGES, 4, stroke="#1971c2")
inner_y += h + 40
s2b, h = section(X0 + 40, inner_y, WF - 80, "2b - App pages (logged in): apps/web/src/app/(app)", APP_PAGES, 4, stroke="#1971c2")
inner_y += h + 40
s2c, h = section(X0 + 40, inner_y, WF - 80, "2c - Shared UI + client plumbing", SHARED_UI, 5, stroke="#1971c2")
inner_y += h + 40
FH = inner_y - fy
front = frame(X0, fy, WF, FH, "2 - FRONTEND  apps/web  (Next.js 16, React 19, Tailwind v4)  :3000", "#1971c2", fr_idx)
lane, lh = section(X0 + WF + 60, fy, LANE_W, "2d - Hits the API directly", LANE, 1, stroke="#0ca678")
lane["height"] = max(lh, FH)
y = fy + max(FH, lh) + 220

# arrows users -> frontend / lane
arrow(actors, front, X0 + 1200, y_act_bottom, X0 + 1200, fy, "browser, HTTPS", lx=X0 + 1220)
arrow(actors, lane, X0 + WF + 60 + LANE_W / 2, y_act_bottom, X0 + WF + 60 + LANE_W / 2, fy,
      "mail-app pixel / click / unsubscribe,\nX-Api-Key lead pushes", color="#0ca678", dashed=True,
      lx=X0 + WF + 60 + LANE_W / 2 - 560)

# 3 backend frame
be_idx = len(ELS)
by = y
inner_y = y + 110
s3a, h = section(X0 + 40, inner_y, W - 80, "3a - Cross-cutting (runs on every request)", CROSS, 5, stroke="#2f9e44")
inner_y += h + 40
s3b, h = section(X0 + 40, inner_y, W - 80, "3b - Feature modules: apps/api/src/*  (REST, ~150 routes)", MODULES, 5, stroke="#2f9e44")
inner_y += h + 40
s3c, h = section(X0 + 40, inner_y, W - 80, "3c - Async: BullMQ queues + workers (same API process)", ASYNC, 3, stroke="#e8590c")
inner_y += h + 40
BH = inner_y - by
back = frame(X0, by, W, BH, "3 - BACKEND  apps/api  (NestJS 11.1.28, one process: REST + Socket.io + workers)  :4000", "#2f9e44", be_idx)
arrow(front, back, X0 + 1200, fy + FH, X0 + 1200, by,
      "REST JSON + Bearer access token, httpOnly refresh cookie, Socket.io /realtime", lx=X0 + 1220)
arrow(lane, back, X0 + WF + 60 + LANE_W / 2, fy + max(FH, lh), X0 + WF + 60 + LANE_W / 2, by,
      "/t, /u, /v1/leads, OAuth callback", color="#0ca678", dashed=True, lx=X0 + WF + 60 + LANE_W / 2 - 470)
y = by + BH + 220

# 4 data + 5 external side by side
DW = int(W * 0.38)
data, dh = section(X0, y, DW, "4 - DATA (Docker locally)", DATA, 1, stroke="#c2255c")
ext, eh = section(X0 + DW + 60, y, W - DW - 60, "5 - EXTERNAL SERVICES", EXTERNAL, 3, stroke="#0ca678")
arrow(back, data, X0 + DW / 2, by + BH, X0 + DW / 2, y,
      "SQL as supersaas_app (RLS), BullMQ + pub/sub", color="#c2255c", lx=X0 + DW / 2 + 20)
arrow(back, ext, X0 + DW + 60 + (W - DW) / 2, by + BH, X0 + DW + 60 + (W - DW) / 2, y,
      "OAuth, Gmail API, SMTP, Gemini / Bedrock", color="#0ca678", dashed=True,
      lx=X0 + DW + 60 + (W - DW) / 2 + 20)
y += max(dh, eh) + 120

# 6 infra
infra, ih = section(X0, y, W, "6 - INFRASTRUCTURE + DEPLOY", INFRA, 5, stroke="#495057")
y += ih + 120

# 7 workflows (rows of chained steps)
wf_idx = len(ELS)
wy = y + 90
LABEL_W = 360
GAP = 70
for name, steps in WORKFLOWS:
    n = len(steps)
    sw = (W - 80 - LABEL_W - 40 - GAP * (n - 1)) / 7 if n <= 7 else 0
    sw = (W - 80 - LABEL_W - 40 - GAP * 6) / 7  # same step width on every row
    rh = max(box_height(sw, b, s) for b, s in steps)
    lbl, _ = box(X0 + 40, wy, LABEL_W, name, A, fs=28, h=rh)
    prev = None
    for i, (b, s) in enumerate(steps):
        sx = X0 + 40 + LABEL_W + 40 + i * (sw + GAP)
        r, _ = box(sx, wy, sw, b, s, h=rh)
        if prev is not None:
            arrow(prev, r, sx - GAP + 4, wy + rh / 2, sx - 4, wy + rh / 2)
        prev = r
    wy += rh + 40
WH = wy - y + 20
add(common("rectangle", X0, y, W, WH, "#1e1e1e", "transparent", strokeStyle="dashed"), at=wf_idx)
text_el(X0 + 24, y + 16, "7 - KEY WORKFLOWS (end to end, left -> right)", fs=FS_HDR)
y += WH + 120

# 8 pending
pend, ph = section(X0, y, W, "8 - WHAT'S LEFT (from docs/BUILD-SUMMARY.md section 14)", PENDING, 3, stroke="#e03131")
y += ph + 120

# 9 design notes
notes, nh2 = section(X0, y, W, "9 - DESIGN NOTES, TRADE-OFFS, BOTTLENECKS", NOTES, 3, stroke="#7048e8")
y += nh2 + 60

# ---------------------------------------------------------------- validate + write
ids = [e["id"] for e in ELS]
assert len(ids) == len(set(ids)), "duplicate ids"
for e in ELS:
    for b in e.get("boundElements") or []:
        assert b["id"] in BY_ID, b
    if e["type"] == "text" and e["containerId"]:
        assert e["containerId"] in BY_ID
    if e["type"] == "arrow":
        assert e["startBinding"]["elementId"] in BY_ID and e["endBinding"]["elementId"] in BY_ID

doc = {"type": "excalidraw", "version": 2, "source": "claude-system-design-skill",
       "elements": ELS,
       "appState": {"gridSize": 20, "gridStep": 5, "gridModeEnabled": True,
                    "viewBackgroundColor": "#ffffff"},
       "files": {}}
os.makedirs(OUT_DIR, exist_ok=True)
with open(OUT, "w", encoding="utf-8") as f:
    json.dump(doc, f, ensure_ascii=False, indent=1)

# rough SVG preview (for layout checking only)
maxx = max(e["x"] + e["width"] for e in ELS) + 100
maxy = max(e["y"] + e["height"] for e in ELS) + 100
svg = [f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {maxx:.0f} {maxy:.0f}" width="{maxx/4:.0f}" height="{maxy/4:.0f}" style="background:#fff;font-family:Segoe Print,Comic Sans MS,sans-serif">']
for e in ELS:
    if e["type"] == "rectangle":
        dash = ' stroke-dasharray="16 10"' if e["strokeStyle"] == "dashed" else ""
        fill = "none" if e["backgroundColor"] == "transparent" else e["backgroundColor"]
        svg.append(f'<rect x="{e["x"]:.0f}" y="{e["y"]:.0f}" width="{e["width"]:.0f}" height="{e["height"]:.0f}" rx="16" fill="{fill}" stroke="{e["strokeColor"]}" stroke-width="{e["strokeWidth"]}"{dash}/>')
    elif e["type"] == "arrow":
        x2, y2 = e["x"] + e["points"][1][0], e["y"] + e["points"][1][1]
        svg.append(f'<line x1="{e["x"]:.0f}" y1="{e["y"]:.0f}" x2="{x2:.0f}" y2="{y2:.0f}" stroke="{e["strokeColor"]}" stroke-width="3"/>')
for e in ELS:
    if e["type"] == "text":
        for i, line in enumerate(e["text"].split("\n")):
            svg.append(f'<text x="{e["x"]:.0f}" y="{e["y"] + (i + 0.85) * e["fontSize"] * LH:.0f}" font-size="{e["fontSize"]}" fill="{e["strokeColor"]}">{escape(line)}</text>')
svg.append("</svg>")
open(PREVIEW, "w", encoding="utf-8").write("\n".join(svg))
print("elements", len(ELS), "canvas", int(maxx), "x", int(maxy))
print(OUT)
