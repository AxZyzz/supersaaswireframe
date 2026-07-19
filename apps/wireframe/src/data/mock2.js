// ─────────────────────────────────────────────────────────────────────────
// Continuation data bank (prompt2.txt). Meeting-driven feature additions.
// Still UI-only / non-functional — all static placeholder data.
// ─────────────────────────────────────────────────────────────────────────

// 1 — AI Business Memory
export const businessMemory = {
  description:
    'Business Lab runs a local business directory. We help service businesses — clinics, law firms, agencies, spas — get more customers from directory visibility through AI-assisted email outreach.',
  urls: [
    { url: 'businesslab.com', purpose: 'Main website', usedByAI: true },
    { url: 'businesslab.com/pricing', purpose: 'Pricing & plans', usedByAI: true },
    { url: 'cal.com/businesslab/demo', purpose: 'Booking link', usedByAI: true },
    { url: 'businesslab.com/cases', purpose: 'Case studies', usedByAI: false },
  ],
  offer: 'Help local businesses get more customers from directory visibility.',
  leadMagnet: 'Free directory visibility audit',
  bookingLink: 'cal.com/businesslab/demo',
  tone: 'Professional but warm',
  personalContext: 'Yakin founded Business Lab after running a local directory for 6 years. Prefers calm, no-hype messaging.',
  objections: [
    { q: 'We already get enough leads.', a: 'No problem — this is about converting directory traffic you already have, not cold outreach.' },
    { q: 'Is this spammy?', a: 'Every email is opt-in from your directory, personalized, and one-click unsubscribe.' },
  ],
  health: [
    { label: 'Website scanned', status: 'done' },
    { label: 'Offer added', status: 'done' },
    { label: 'Calendar link added', status: 'done' },
    { label: 'Reply rules', status: 'missing' },
  ],
}

// 2 — List-first lead management
export const leadLists = [
  { id: 'hot-leads', name: 'Hot Leads', source: 'Google Sheet', count: 320, sync: 'Synced', lastSync: '8 min ago', campaign: 'Q3 Directory Outreach' },
  { id: 'march-import', name: 'March Import', source: 'CSV / Excel', count: 142, sync: 'One-time', lastSync: '2 days ago', campaign: '—' },
  { id: 'bd-members', name: 'Directory Members', source: 'Brilliant Directories', count: 6120, sync: 'Connected', lastSync: '32 min ago', campaign: 'Welcome Sequence' },
  { id: 'api-inbound', name: 'API Inbound', source: 'REST API', count: 0, sync: 'Waiting', lastSync: 'Never', campaign: '—' },
]
export const leadListById = (id) => leadLists.find((l) => l.id === id) || leadLists[0]

export const syncHealth = [
  { source: 'Google Sheet', status: 'Synced 8 min ago', tone: 'success' },
  { source: 'Brilliant Directories', status: 'Connected · 142 changed records', tone: 'info' },
  { source: 'REST API', status: 'Waiting for first request', tone: 'neutral' },
]

export const listSourceTabs = ['CSV / Excel', 'Google Sheet', 'Brilliant Directories', 'REST API']

// 3 — Global sender pool
export const senderPool = [
  { email: 'outreach@businesslab.com', provider: 'Google', status: 'Verified', cap: 30, ramp: 'Mature', lastUsed: '2m ago', campaigns: 3 },
  { email: 'hello@businesslab.com', provider: 'SMTP', status: 'Action needed', cap: 30, ramp: 'Week 3', lastUsed: '1h ago', campaigns: 1 },
  { email: 'team@businesslab.com', provider: 'Google', status: 'Verified', cap: 30, ramp: 'Week 2', lastUsed: '4h ago', campaigns: 2 },
  { email: 'yakin@businesslab.com', provider: 'Microsoft', status: 'Verified', cap: 30, ramp: 'Mature', lastUsed: '1d ago', campaigns: 4 },
  { email: 'sales@businesslab.com', provider: 'SMTP', status: 'Verified', cap: 30, ramp: 'Week 1', lastUsed: '3d ago', campaigns: 0 },
  { email: 'partners@businesslab.com', provider: 'Google', status: 'Verified', cap: 30, ramp: 'Mature', lastUsed: '5h ago', campaigns: 2 },
  { email: 'connect@businesslab.com', provider: 'Google', status: 'Warming', cap: 16, ramp: 'Week 3', lastUsed: '6h ago', campaigns: 1 },
]
export const totalSenders = 20

export const rampStages = [
  { stage: 'Week 1', range: '0–7 / day' },
  { stage: 'Week 2', range: '5–10 / day' },
  { stage: 'Week 3', range: '11–16 / day' },
  { stage: 'Week 4', range: '16–24 / day' },
  { stage: 'Mature', range: '0–30 / day' },
]

export const senderSchedule = [
  { day: 'Monday', s1: 22, s2: 27, s3: 20 },
  { day: 'Tuesday', s1: 27, s2: 21, s3: 24 },
  { day: 'Wednesday', s1: 19, s2: 28, s3: 23 },
  { day: 'Thursday', s1: 25, s2: 22, s3: 26 },
  { day: 'Friday', s1: 21, s2: 24, s3: 19 },
]

// 5 — AI reply learning classifications (extends base set)
export const replyClasses = [
  { key: 'Interested', tone: 'success', approvals: 9, auto: false },
  { key: 'Question', tone: 'warning', approvals: 4, auto: false },
  { key: 'Out of office', tone: 'info', approvals: 10, auto: false },
  { key: 'Not interested', tone: 'danger', approvals: 12, auto: true },
  { key: 'Wrong person', tone: 'neutral', approvals: 3, auto: false },
  { key: 'Hiring/Candidate', tone: 'purple', approvals: 1, auto: false },
  { key: 'Vendor', tone: 'neutral', approvals: 2, auto: false },
  { key: 'Support', tone: 'info', approvals: 5, auto: false },
  { key: 'Manual review', tone: 'neutral', approvals: 0, auto: false },
]

// 6 — Timestamped events
export const leadEvents = [
  { type: 'Email sent', time: 'Jun 19, 10:02 AM', source: 'Pixel', detail: 'Email 1 · Quick idea for Bright Dental · sender outreach@businesslab.com' },
  { type: 'Opened', time: 'Jun 19, 10:18 AM', source: 'Pixel', detail: 'Opened on mobile · Mumbai, IN' },
  { type: 'Opened again', time: 'Jun 19, 11:44 AM', source: 'Pixel', detail: 'Opened on desktop' },
  { type: 'Clicked', time: 'Jun 19, 11:46 AM', source: 'Click redirect', detail: 'cal.com/businesslab/demo' },
  { type: 'Replied', time: 'Jun 19, 12:07 PM', source: 'Reply parser', detail: 'Classified: Interested' },
]
export const openCount = 4

export const trackedEvents = [
  { lead: 'Anita Sharma', event: 'Replied', campaign: 'Q3 Directory Outreach', time: 'Jun 19, 12:07 PM' },
  { lead: 'Marcus Lee', event: 'Opened', campaign: 'Q3 Directory Outreach', time: 'Jun 19, 11:52 AM' },
  { lead: 'Grace Kim', event: 'Clicked', campaign: 'Welcome Sequence', time: 'Jun 19, 11:40 AM' },
  { lead: 'Priya Nair', event: 'Out of office', campaign: 'Q3 Directory Outreach', time: 'Jun 19, 10:31 AM' },
  { lead: 'Sara Mendez', event: 'Unsubscribed', campaign: 'Spa Promo', time: 'Jun 18, 6:12 PM' },
]

// 7 — AI campaign recommendations
export const aiRecommendations = [
  { kind: 'Stop', tone: 'danger', text: 'Template 4 has low opens and zero conversions.', action: 'Pause template' },
  { kind: 'Continue', tone: 'success', text: 'Template 2 has lower opens but one conversion. Keep testing.', action: 'Keep in test' },
  { kind: 'Improve', tone: 'warning', text: 'Subject line may be weak for clinics.', action: 'Rewrite subject' },
  { kind: 'Generate', tone: 'info', text: 'Create 5 new variants from top performers.', action: 'Generate variants' },
  { kind: 'Apply', tone: 'purple', text: 'Pause bottom 50% and test new variants.', action: 'Apply test' },
]
export const weeklyAiSummary = 'This week: 2 templates paused, 5 variants suggested, 1 audience segment improved.'

// 8 — Conversion-aware analytics
export const campaignGoals = ['Book a call', 'Paid signup', 'Upgrade listing', 'Website traffic', 'Custom API event']
export const conversionTemplates = [
  { name: 'Template A — Clinics', open: 7, conversions: 1 },
  { name: 'Template B — Law firms', open: 2, conversions: 1 },
  { name: 'Template C — Agencies', open: 5, conversions: 0 },
]
export const conversionNote = 'Do not judge by opens alone. Both A and B converted; keep Template B in test.'

// 9 — Signal rules
export const signalRules = [
  { signal: 'signed_up', action: 'Stop current outreach campaign', tone: 'success' },
  { signal: 'profile_incomplete', action: 'Start profile-completion nurture', tone: 'warning' },
  { signal: 'employment_updated', action: 'Skip employment reminder', tone: 'neutral' },
  { signal: 'paid_listing_upgraded', action: 'Move to upsell sequence', tone: 'info' },
]

// 10 — White-label / Super SaaS
export const saasSetup = {
  productName: 'Business Lab Outreach',
  brandColor: '#3E63DD',
  customDomain: 'app.businesslab.com',
  supportEmail: 'support@businesslab.com',
  planName: 'Business Lab Growth',
  about: 'Outreach, built for our directory members.',
}

// 11 — Plan limits / usage
export const planLimits = [
  {
    name: 'Starter',
    price: '$0',
    note: 'Free forever',
    limits: { leads: '1,000', emails: '5,000 / mo', campaigns: '2 active', senders: '1', ai: '5 / mo' },
    cta: 'Start free',
  },
  {
    name: 'Growth',
    price: '$49',
    note: 'per month',
    highlight: true,
    limits: { leads: '25,000', emails: '100,000 / mo', campaigns: '10 active', senders: '20', ai: '100 / mo' },
    cta: 'Start free',
  },
  {
    name: 'Scale',
    price: '$149',
    note: 'per month',
    limits: { leads: 'Unlimited', emails: '500,000 / mo', campaigns: 'Unlimited', senders: '100', ai: 'Unlimited' },
    cta: 'Contact sales',
  },
]
export const usage = {
  leads: { used: 12500, max: 25000 },
  emails: { used: 38210, max: 100000 },
  campaigns: { used: 5, max: 10 },
  senders: { used: 7, max: 20 },
  ai: { used: 32, max: 100 },
}

// 12 — Future channels
export const futureChannels = [
  { name: 'Email', status: 'Active', tone: 'success' },
  { name: 'SMS', status: 'Roadmap', tone: 'neutral' },
  { name: 'WhatsApp', status: 'Roadmap', tone: 'neutral' },
  { name: 'Inland letter', status: 'Roadmap', tone: 'neutral' },
  { name: 'AI calling / reception', status: 'Future', tone: 'neutral' },
]

// 13 — Documentation center
export const docsSidebar = [
  'Overview',
  'Quick start checklist',
  'Onboarding and workspace setup',
  'AI business memory',
  'Lead lists and imports',
  'Google Sheet sync',
  'Brilliant Directories sync',
  'REST API lead sync',
  'Sender accounts and ramp-up',
  'Campaign builder',
  'AI campaign assistant',
  'Templates and variables',
  'Unified inbox and reply routing',
  'AI reply learning',
  'Analytics and event timeline',
  'Conversion and signal rules',
  'White-label setup',
  'Admin and monitoring',
  'Roadmap features',
]

export const quickStartSteps = [
  { t: 'Set up workspace and business memory.', to: '/settings?tab=ai-memory' },
  { t: 'Connect sender accounts.', to: '/settings?tab=senders' },
  { t: 'Create or sync a lead list.', to: '/leads' },
  { t: 'Build a campaign manually or with AI.', to: '/campaigns/new' },
  { t: 'Review email sequence and launch.', to: '/campaigns/new/sequence' },
  { t: 'Manage replies in the unified inbox.', to: '/inbox' },
  { t: 'Review analytics and AI recommendations.', to: '/analytics' },
  { t: 'Use settings/admin for brand, users, senders, and operations.', to: '/admin' },
]

export const docsCards = [
  { file: 'client_ready_project_scope_budget_report.md', desc: 'Client-ready scope, budget, timeline, and support plan.', status: 'Final' },
  { file: 'clickable_prototype_ui_master_prompt.md', desc: 'Main UI prototype build prompt.', status: 'Final' },
  { file: 'clickable_prototype_build_prompt_standalone.md', desc: 'Clean forward-ready build brief.', status: 'Final' },
  { file: 'clickable_prototype_ui_continuation_meeting_features.md', desc: 'Meeting-driven feature continuation brief.', status: 'Working' },
  { file: 'Meeting transcripts/', desc: 'Source meeting transcripts used for product decisions.', status: 'Reference' },
  { file: 'system_design.excalidraw', desc: 'Initial system architecture / source diagram.', status: 'Reference' },
]

// White-label second workspace for Admin
export const partnerWorkspace = { ws: 'JustDial-style Partner Demo', owner: 'Partner Admin', plan: 'Scale', leads: 51200, sent: 168400, status: 'Active', whitelabel: 'Live' }
