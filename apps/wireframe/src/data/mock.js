// ─────────────────────────────────────────────────────────────────────────
// Placeholder data bank (Appendix B). Reused across every screen so the demo
// feels coherent. This is a UI-only prototype — none of this is real data.
// ─────────────────────────────────────────────────────────────────────────

export const workspace = {
  name: 'Business Lab',
  logoInitials: 'BL',
  domain: 'businesslab.com',
  plan: 'Growth',
}

export const user = {
  name: 'Yakin Shah',
  initials: 'YS',
  email: 'yakin@businesslab.com',
  role: 'Owner',
}

export const senders = [
  { email: 'outreach@businesslab.com', provider: 'Google', limit: 50, status: 'Verified' },
  { email: 'hello@businesslab.com', provider: 'SMTP', limit: 50, status: 'Action needed' },
]

export const segments = [
  { name: 'Hot Leads', count: 320 },
  { name: 'New this week', count: 142 },
  { name: 'Dentists', count: 610 },
  { name: 'Agencies', count: 88 },
  { name: 'Spas', count: 54 },
]

// Avatar tints cycle through the semantic palette for variety.
const tints = [
  { bg: '#EDF0FD', text: '#3E63DD' },
  { bg: '#E7F5EA', text: '#2A7E3B' },
  { bg: '#F2EBFE', text: '#7C3AED' },
  { bg: '#FFF4D6', text: '#9A6700' },
  { bg: '#FCEBEC', text: '#C62A2F' },
  { bg: '#F1F1F1', text: '#666666' },
]
export const tintFor = (seed) => {
  let h = 0
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) % tints.length
  return tints[h]
}

export const initialsOf = (name) =>
  name
    .split(' ')
    .map((n) => n[0])
    .slice(0, 2)
    .join('')
    .toUpperCase()

export const leads = [
  { id: 'anita-sharma', name: 'Anita Sharma', email: 'anita@brightdental.com', company: 'Bright Dental', title: 'Practice Owner', tags: ['Hot', 'Dentist'], source: 'CSV', status: 'Interested', last: '2h ago', phone: '+91 98200 11223' },
  { id: 'marcus-lee', name: 'Marcus Lee', email: 'marcus@peaklegal.co', company: 'Peak Legal', title: 'Partner', tags: ['Law'], source: 'Google Sheet', status: 'Replied', last: '5h ago', phone: '+1 415 555 0142' },
  { id: 'priya-nair', name: 'Priya Nair', email: 'priya@nairclinic.in', company: 'Nair Skin Clinic', title: 'Founder', tags: ['Clinic', 'Hot'], source: 'API', status: 'Contacted', last: '1d ago', phone: '+91 99400 55667' },
  { id: 'david-cohen', name: 'David Cohen', email: 'david@cohenrealty.com', company: 'Cohen Realty', title: 'Broker', tags: ['Real estate'], source: 'Brilliant Directories', status: 'New', last: '1d ago', phone: '+1 212 555 0190' },
  { id: 'sara-mendez', name: 'Sara Mendez', email: 'sara@mendezspa.com', company: 'Mendez Spa', title: 'Owner', tags: ['Spa'], source: 'CSV', status: 'Bounced', last: '2d ago', phone: '+1 305 555 0173' },
  { id: 'tom-becker', name: 'Tom Becker', email: 'tom@beckerfit.com', company: 'Becker Fitness', title: 'Director', tags: ['Gym'], source: 'CSV', status: 'New', last: '2d ago', phone: '+1 503 555 0128' },
  { id: 'lena-petrova', name: 'Lena Petrova', email: 'lena@petrovalaw.com', company: 'Petrova Law', title: 'Managing Partner', tags: ['Law', 'Hot'], source: 'Google Sheet', status: 'Replied', last: '3d ago', phone: '+1 718 555 0166' },
  { id: 'omar-farouk', name: 'Omar Farouk', email: 'omar@faroukdental.com', company: 'Farouk Dental', title: 'Dentist', tags: ['Dentist'], source: 'API', status: 'Contacted', last: '3d ago', phone: '+971 50 555 0144' },
  { id: 'grace-kim', name: 'Grace Kim', email: 'grace@kimagency.co', company: 'Kim Agency', title: 'CEO', tags: ['Agency'], source: 'CSV', status: 'Interested', last: '4d ago', phone: '+1 408 555 0119' },
  { id: 'john-patel', name: 'John Patel', email: 'john@patelco.com', company: 'Patel & Co', title: 'Principal', tags: ['Finance'], source: 'CSV', status: 'New', last: '5d ago', phone: '+44 20 7946 0102' },
]

export const leadById = (id) => leads.find((l) => l.id === id) || leads[0]

// Status -> tag tone
export const leadStatusTone = {
  New: 'neutral',
  Contacted: 'info',
  Replied: 'purple',
  Interested: 'success',
  Bounced: 'danger',
}

export const tagTone = (tag) => {
  const map = {
    Hot: 'danger',
    Dentist: 'info',
    Clinic: 'purple',
    Law: 'warning',
    'Real estate': 'success',
    Spa: 'purple',
    Gym: 'info',
    Agency: 'warning',
    Finance: 'success',
  }
  return map[tag] || 'neutral'
}

export const sourceTone = 'neutral'

export const campaigns = [
  { id: 'q3-directory-outreach', name: 'Q3 Directory Outreach', status: 'Sending', segment: 'Hot Leads', senders: 2, sent: 1240, open: 58, reply: 9.1, interested: 41, unsub: 6, created: 'Jun 2', progress: 64 },
  { id: 'welcome-sequence', name: 'Welcome Sequence', status: 'Completed', segment: 'New this week', senders: 1, sent: 3400, open: 61, reply: 7.8, interested: 96, unsub: 12, created: 'May 18', progress: 100 },
  { id: 'dentist-re-engagement', name: 'Dentist Re-engagement', status: 'Paused', segment: 'Dentists', senders: 1, sent: 820, open: 49, reply: 5.2, interested: 18, unsub: 4, created: 'May 24', progress: 38 },
  { id: 'agency-partners', name: 'Agency Partners', status: 'Draft', segment: 'Agencies', senders: 0, sent: null, open: null, reply: null, interested: null, unsub: null, created: 'Jun 10', progress: 0 },
  { id: 'spa-promo', name: 'Spa Promo', status: 'Scheduled', segment: 'Spas', senders: 1, sent: null, open: null, reply: null, interested: null, unsub: null, created: 'Jun 14', progress: 0 },
]

export const campaignById = (id) => campaigns.find((c) => c.id === id) || campaigns[0]

export const campaignStatusTone = {
  Sending: 'info',
  Completed: 'success',
  Paused: 'warning',
  Draft: 'neutral',
  Scheduled: 'purple',
}

export const activity = [
  { icon: 'reply', text: "Anita replied to 'Q3 Directory Outreach'", time: '2h ago' },
  { icon: 'check', text: "Campaign 'Welcome Sequence' completed", time: '6h ago' },
  { icon: 'upload', text: '142 new leads imported from CSV', time: '1d ago' },
  { icon: 'send', text: "Sender rotation started for 'Q3 Directory Outreach'", time: '1d ago' },
  { icon: 'tag', text: "Tag 'Hot' added to 18 leads", time: '2d ago' },
]

export const templates = [
  { id: 'cold-intro-clinics', name: 'Cold intro — Clinics', subject: 'Quick idea for {{company}}', edited: '2d ago', usedIn: 4 },
  { id: 'follow-up-bump', name: 'Follow-up bump', subject: 'Following up, {{first_name}}', edited: '5d ago', usedIn: 7 },
  { id: 're-engagement', name: 'Re-engagement', subject: 'Still worth a chat?', edited: '1w ago', usedIn: 3 },
  { id: 'partner-outreach', name: 'Partner outreach', subject: 'Partnering with {{company}}', edited: '1w ago', usedIn: 2 },
  { id: 'final-nudge', name: 'Final nudge', subject: 'Last note about {{company}}', edited: '2w ago', usedIn: 5 },
]

// Inbox classifications
export const classifications = [
  { key: 'Interested', tone: 'success' },
  { key: 'Not interested', tone: 'danger' },
  { key: 'Question', tone: 'warning' },
  { key: 'Out of office', tone: 'info' },
  { key: 'Wrong person', tone: 'neutral' },
  { key: 'Manual review', tone: 'neutral' },
]

export const conversations = [
  {
    id: 'anita-sharma',
    leadId: 'anita-sharma',
    name: 'Anita Sharma',
    company: 'Bright Dental',
    subject: 'Re: Quick idea for Bright Dental',
    snippet: "Yes, I'd love to hear more…",
    classification: 'Interested',
    time: '2h',
    unread: true,
    campaign: 'Q3 Directory Outreach',
    thread: [
      { dir: 'out', from: 'outreach@businesslab.com', time: 'Mon 9:02 AM', body: 'Hi Anita, I came across Bright Dental in the directory and had a quick idea on getting more patient enquiries. Worth a short call this week?' },
      { dir: 'in', from: 'anita@brightdental.com', time: 'Mon 11:40 AM', body: "Yes, I'd love to hear more. We're trying to grow new patient bookings this quarter. What times work for you?" },
    ],
  },
  {
    id: 'marcus-lee',
    leadId: 'marcus-lee',
    name: 'Marcus Lee',
    company: 'Peak Legal',
    subject: 'Re: Quick idea for Peak Legal',
    snippet: 'Who is this?',
    classification: 'Question',
    time: '5h',
    unread: false,
    campaign: 'Q3 Directory Outreach',
    thread: [
      { dir: 'out', from: 'outreach@businesslab.com', time: 'Mon 9:05 AM', body: 'Hi Marcus, I came across Peak Legal in the directory and had a quick idea worth sharing. Open to a short call?' },
      { dir: 'in', from: 'marcus@peaklegal.co', time: 'Mon 2:15 PM', body: 'Who is this? How did you get my email?' },
    ],
  },
  {
    id: 'priya-nair',
    leadId: 'priya-nair',
    name: 'Priya Nair',
    company: 'Nair Skin Clinic',
    subject: 'Out of office until Monday',
    snippet: 'I am currently away…',
    classification: 'Out of office',
    time: '1d',
    unread: false,
    campaign: 'Q3 Directory Outreach',
    thread: [
      { dir: 'out', from: 'outreach@businesslab.com', time: 'Sun 10:00 AM', body: 'Hi Priya, quick idea for Nair Skin Clinic on getting more bookings — worth a chat?' },
      { dir: 'in', from: 'priya@nairclinic.in', time: 'Sun 10:01 AM', body: 'I am currently away from the office until Monday and will reply on my return. For urgent matters call the front desk.' },
    ],
  },
  {
    id: 'sara-mendez',
    leadId: 'sara-mendez',
    name: 'Sara Mendez',
    company: 'Mendez Spa',
    subject: 'Please remove me',
    snippet: 'Please remove me from this list.',
    classification: 'Not interested',
    time: '1d',
    unread: false,
    campaign: 'Spa Promo',
    thread: [
      { dir: 'out', from: 'hello@businesslab.com', time: 'Sat 4:30 PM', body: 'Hi Sara, a quick idea for Mendez Spa on filling midweek slots — open to a short call?' },
      { dir: 'in', from: 'sara@mendezspa.com', time: 'Sat 6:12 PM', body: 'Please remove me from this list. Not interested, thanks.' },
    ],
  },
  {
    id: 'david-cohen',
    leadId: 'david-cohen',
    name: 'David Cohen',
    company: 'Cohen Realty',
    subject: 'Re: Following up',
    snippet: 'Maybe next quarter.',
    classification: 'Manual review',
    time: '2d',
    unread: false,
    campaign: 'Q3 Directory Outreach',
    thread: [
      { dir: 'out', from: 'outreach@businesslab.com', time: 'Thu 9:10 AM', body: 'Hi David, following up on my note about Cohen Realty — still happy to share the idea whenever suits.' },
      { dir: 'in', from: 'david@cohenrealty.com', time: 'Fri 8:45 AM', body: "Appreciate it, but we're heads-down right now. Maybe next quarter — feel free to check back." },
    ],
  },
]

export const conversationById = (id) => conversations.find((c) => c.id === id) || conversations[0]

// ── Chart data (static) ───────────────────────────────────────────────────
export const sendSeries = [
  { day: 'Wk 1', sent: 4200, opens: 2350, replies: 290 },
  { day: 'Wk 2', sent: 6100, opens: 3480, replies: 420 },
  { day: 'Wk 3', sent: 7400, opens: 4180, replies: 560 },
  { day: 'Wk 4', sent: 9200, opens: 5340, replies: 690 },
  { day: 'Wk 5', sent: 6300, opens: 3690, replies: 470 },
  { day: 'Wk 6', sent: 5010, opens: 2980, replies: 360 },
]

export const repliesByClass = [
  { name: 'Interested', value: 41, tone: '#2A7E3B' },
  { name: 'Question', value: 26, tone: '#9A6700' },
  { name: 'Out of office', value: 18, tone: '#3E63DD' },
  { name: 'Not interested', value: 15, tone: '#C62A2F' },
]

export const leadSources = [
  { name: 'CSV', leads: 6120, reply: 7.1, tone: '#3E63DD' },
  { name: 'Google Sheet', leads: 3240, reply: 8.4, tone: '#2A7E3B' },
  { name: 'API', leads: 2010, reply: 6.2, tone: '#7C3AED' },
  { name: 'Brilliant Directories', leads: 1110, reply: 9.6, tone: '#9A6700' },
]

export const followupFunnel = [
  { step: 'Email 1', sent: 12480, replies: 540 },
  { step: 'Email 2', sent: 9100, replies: 320 },
  { step: 'Email 3', sent: 6400, replies: 180 },
]

export const rampSeries = [
  { d: 'D1', v: 10 },
  { d: 'D2', v: 16 },
  { d: 'D3', v: 24 },
  { d: 'D4', v: 32 },
  { d: 'D5', v: 40 },
  { d: 'D6', v: 50 },
]

// Admin
export const adminWorkspaces = [
  { ws: 'Business Lab', owner: 'Yakin Shah', plan: 'Growth', leads: 12480, sent: 38210, status: 'Active' },
  { ws: 'NorthStar Directory', owner: 'M. Alvarez', plan: 'Scale', leads: 48200, sent: 142300, status: 'Active' },
  { ws: 'CityBiz Hub', owner: 'R. Okafor', plan: 'Starter', leads: 980, sent: 2100, status: 'Active' },
  { ws: 'GreenList Co', owner: 'S. Tan', plan: 'Growth', leads: 7340, sent: 19800, status: 'Suspended' },
  { ws: 'MediConnect', owner: 'P. Bose', plan: 'Scale', leads: 26100, sent: 88400, status: 'Active' },
]

export const adminLogs = [
  { time: '14:42:08', level: 'Error', msg: 'SMTP timeout on hello@businesslab.com (retry 2/3)', source: 'sender-worker' },
  { time: '14:30:55', level: 'Warn', msg: 'Daily limit reached for outreach@northstar.co', source: 'rate-limiter' },
  { time: '13:58:11', level: 'Warn', msg: 'DKIM record missing for greenlist.co', source: 'domain-check' },
  { time: '13:12:40', level: 'Error', msg: 'Webhook delivery failed (502) to citybiz endpoint', source: 'webhooks' },
]
