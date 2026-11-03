/**
 * In-app help center content. Each article's body is a tiny markup:
 *   "## Heading", "- bullet", "```" fenced code, blank line = paragraph break.
 * Keep it true to shipped behaviour — update alongside features.
 */
export interface DocArticle {
  slug: string;
  title: string;
  section: string;
  summary: string;
  body: string;
}

export const DOC_SECTIONS = [
  "Getting started",
  "Leads",
  "Campaigns",
  "Sending",
  "Inbox",
  "Workspace",
] as const;

export const DOCS: DocArticle[] = [
  {
    slug: "quick-start",
    section: "Getting started",
    title: "Quick start",
    summary: "From an empty workspace to your first campaign in five steps.",
    body: `The dashboard's **Start here** checklist tracks these for you.

- Teach the AI your business in Settings → Knowledge base (what you do, who you sell to, your offer).
- Connect a sender in Settings → Sender accounts and verify it.
- Import leads from a CSV on the Leads page.
- Create a campaign — let the AI draft the sequence or build it step by step.
- Enroll leads and launch. Replies arrive in the Inbox.

## Roles
Admins can do everything. Managers run campaigns, senders and templates. Agents view and edit leads and work the inbox. See "Team & roles".`,
  },
  {
    slug: "import-leads",
    section: "Leads",
    title: "Importing leads (CSV, Excel, Google Sheets)",
    summary: "Column mapping, duplicates, limits and Sheets sync.",
    body: `On Leads, choose **Import CSV** (admins and managers), pick a CSV or Excel file (up to 5 MB) and map each column to a lead field. Unmapped columns are skipped.

## From Google Sheets
In the same dialog choose **Google Sheet**. The first time, **Connect Google Sheets** and sign in: SuperSaaS only asks to *view* your spreadsheets. Paste the sheet's link, pick the tab, map the columns (the first row must be the column names) and import. The sheet must be owned by, or shared with, the connected Google account.

Leave **Keep in sync** on to re-import new and changed rows every hour. Manage synced sheets in **Settings → Integrations**: *Sync now*, pause the hourly sync, or remove a sheet. Removing a sheet or disconnecting Google keeps the leads already imported.

## Duplicates
Emails are matched case-insensitively. Choose **Skip** to leave existing leads untouched, or **Update** to fill them in from the file. Use **Duplicates** afterwards to review and merge matches (admins and managers).

## Fields
Email, first/last name, company, title, phone, status, score (hot / warm / cold) and source. Anything else can live in custom fields.`,
  },
  {
    slug: "segments",
    section: "Leads",
    title: "Smart segments",
    summary: "Rule-based lists that keep themselves up to date.",
    body: `A segment is a saved set of rules — for example *status is interested* AND *score is hot*. Match **all** rules or **any** rule.

Segments refresh in the background; use **Refresh** on a segment to recount right away. Pick a segment as a campaign's audience to target exactly those leads.`,
  },
  {
    slug: "leads-api",
    section: "Leads",
    title: "Leads REST API",
    summary: "Push leads in from your own systems with an API key.",
    body: `Create a key in Settings → API keys (shown once — store it safely). Send it in the **X-Api-Key** header.

\`\`\`
POST /v1/leads
X-Api-Key: <your key>
Content-Type: application/json

{ "email": "ana@acme.com", "firstName": "Ana", "company": "Acme",
  "source": "website-form" }
\`\`\`

The call is an **upsert by email**: an existing lead is updated (only the fields you send), otherwise a new one is created. The response is \`{ "lead": {...}, "created": true | false }\`.

Limit: 120 requests per minute. Revoke a key at any time from Settings.`,
  },
  {
    slug: "ai-builder",
    section: "Campaigns",
    title: "Writing sequences with AI",
    summary: "How the AI drafts emails and how to get better output.",
    body: `In Campaigns choose **AI draft**, describe the goal and audience, and pick the number of steps. The AI drafts every step grounded in your **Knowledge base**, then you review and edit before creating the campaign.

## Better output
- Fill in the knowledge base — offer, pain points, proof. Specifics beat adjectives.
- Name one clear call to action (a reply, a 15-minute call).
- Edit the first line of each email; it carries the most weight.`,
  },
  {
    slug: "campaigns",
    section: "Campaigns",
    title: "Campaigns, steps and scheduling",
    summary: "Delays, conditions, subject tests, pausing.",
    body: `A campaign is an ordered list of steps. Each step has a template, a delay (hours after the previous step) and a condition:

- **Always** — send regardless.
- **Opened, no reply** — only to leads who opened the last email.
- **Not opened** — a fresh angle for leads who didn't open.

Add up to 5 subject-line variants on a step to test which one lands.

Launch now or **schedule** a start time. You can pause and resume at any time, and **duplicate** a campaign to reuse its structure.`,
  },
  {
    slug: "personalization",
    section: "Campaigns",
    title: "Personalization variables",
    summary: "Insert lead details with {variable} tokens.",
    body: `Write tokens in single braces. Add a fallback after a pipe for leads missing that field.

\`\`\`
Hi {first_name|there}, saw what {company} is doing with...
\`\`\`

Available: first_name, last_name, company, business_name, title, email, phone, sender_name.

Unknown tokens are left as-is so typos show up in the preview instead of silently disappearing.`,
  },
  {
    slug: "senders",
    section: "Sending",
    title: "Sender accounts and limits",
    summary: "Connecting mailboxes, daily limits, send windows.",
    body: `Each sender is a mailbox campaigns send from. SMTP mailboxes and Gmail accounts connect today; Amazon SES is rolling out.

## Connecting Gmail
In **Settings → Sender accounts** choose **Connect Gmail** and sign in with Google. Keep the *Send email on your behalf* box ticked. SuperSaaS only asks for permission to send, not to read your mail. The account appears verified and starts on the warm-up ramp. If Google access is ever revoked, the sender turns *unverified*; choose **reconnect** next to it.

## Protecting your reputation
- **Daily limit** per sender (default 50) caps how much it sends in a day.
- **Send window** restricts sending to working hours.
- **Warm-up**: new senders ramp automatically — 20/day for the first week, 50/day in week two, 100/day until day 30, then your daily limit. Already-established mailbox? Choose *skip* next to it in Sender accounts.

The dashboard warns you when a sender is unverified or close to its daily limit.`,
  },
  {
    slug: "deliverability",
    section: "Sending",
    title: "Domain authentication (SPF, DKIM, DMARC)",
    summary: "The three DNS records that keep you out of spam.",
    body: `Use the **Domain authentication check** under Sender accounts to look up your live DNS.

- **SPF** — a TXT record listing who may send for your domain.
- **DKIM** — a signing key so inboxes can verify your mail wasn't altered.
- **DMARC** — tells inboxes what to do with mail that fails the above. Start with \`p=none\` to monitor.

Your mail provider supplies the exact SPF and DKIM values. DNS changes can take up to an hour to show.`,
  },
  {
    slug: "inbox",
    section: "Inbox",
    title: "Replies and automations",
    summary: "Classification, auto-stop, assignment and notes.",
    body: `Every reply is threaded with the emails you sent and classified by intent:

- **Interested** / **Question** — the sequence stops so a human takes over.
- **Out of office** — the sequence pauses; the next step moves out 3 days.
- **Not interested** — the sequence stops and the lead is tagged.
- **Needs review** — the classifier wasn't sure; you decide.

Reclassify anything with one click. Assign conversations to teammates, leave internal notes, and **mark converted** to close the loop on a win.`,
  },
  {
    slug: "unsubscribes",
    section: "Inbox",
    title: "Unsubscribes and suppression",
    summary: "Why some leads never receive email.",
    body: `Every campaign email includes a one-click unsubscribe link. Unsubscribed addresses join your suppression list, which is checked before every send — they won't be emailed again from any campaign.`,
  },
  {
    slug: "team",
    section: "Workspace",
    title: "Team & roles",
    summary: "Inviting teammates and what each role can do.",
    body: `Admins invite teammates from Settings → Team. Each invite is a single-use link that expires after 7 days — copy it and send it however you like.

- **Admin** — everything, including team, branding and workspace settings.
- **Manager** — campaigns, senders, templates, knowledge base, leads and inbox.
- **Agent** — adds, edits and tags leads and works the inbox. Can browse templates and campaigns but not change them, import CSVs, merge or delete leads.

Role changes and removals apply immediately. A workspace always keeps at least one admin.`,
  },
  {
    slug: "plan-limits",
    section: "Workspace",
    title: "Plan limits",
    summary: "What the free beta includes and what happens at a limit.",
    body: `Every workspace is on a plan. During the public beta that's free, with fair-use limits: 2,000 leads, 5 active (or scheduled) campaigns, 5 steps per campaign, 3 sender accounts, 3 team members, 100 emails a day and 1,000 a month, and 30 AI sequence generations a month.

See live usage in Settings → **Plan & usage**. The dashboard warns you at 80%.

## At a limit
- Creating more of that thing is blocked with a clear message — nothing existing is changed.
- **CSV imports** add rows until the lead limit, then report the rest as skipped.
- **Pending invites** count as seats until accepted, revoked or expired.
- **Emails** over the daily or monthly cap are not dropped: they wait and go out once the cap resets (daily at midnight UTC, monthly on the 1st).`,
  },
  {
    slug: "privacy-data",
    section: "Workspace",
    title: "Privacy, export and deletion",
    summary: "Postal address, erasure requests, exporting and deleting data.",
    body: `## Postal address (CAN-SPAM)
Add your business postal address in Settings → Workspace. It's printed with your workspace name in the footer of every campaign email, next to the one-click unsubscribe link. The dashboard reminds you until it's set.

## When a person asks to be forgotten
Open the lead and choose **Forget**. Their record, notes and history are deleted, and their email address goes on your suppression list so no campaign ever emails them again. (Plain **Delete** removes the lead without suppressing it.)

## Export
Admins can download everything in the workspace as JSON from Settings → **Data & privacy**: leads, campaigns, templates, conversations, members and the suppression list. Sender passwords and tokens are never included.

## Deleting
- **Delete workspace** (admins) permanently removes the workspace for everyone. Type its name to confirm. Members with no other workspace lose their accounts too.
- **Delete my account** (anyone) needs your password. Workspaces where you're the only member go with it. If you're the only admin of a shared workspace, make someone else admin first.

Deletion is immediate and cannot be undone.`,
  },
  {
    slug: "branding",
    section: "Workspace",
    title: "Branding",
    summary: "Your logo and accent color across the app.",
    body: `Admins set a logo and accent color in Settings → Workspace. The accent recolors buttons, badges and highlights for everyone in the workspace; the logo replaces the initials in the sidebar.`,
  },
];

export const docBySlug = (slug: string) => DOCS.find((d) => d.slug === slug);
