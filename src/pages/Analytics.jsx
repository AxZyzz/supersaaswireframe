import { useState } from 'react'
import { useParams, Link, useNavigate } from 'react-router-dom'
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  PieChart,
  Pie,
  Cell,
  Legend,
  LineChart,
  Line,
} from 'recharts'
import { Download, ChevronRight, Sparkles, ArrowRight, X } from 'lucide-react'
import { Card, StatCard, Tag, Tabs, Button, Modal, Toast, useToast, cx } from '../components/ui.jsx'
import {
  sendSeries,
  repliesByClass,
  leadSources,
  followupFunnel,
  campaigns,
  templates,
  campaignById,
} from '../data/mock.js'
import {
  aiRecommendations,
  weeklyAiSummary,
  trackedEvents,
  conversionTemplates,
  conversionNote,
} from '../data/mock2.js'
import FutureChannels from '../components/FutureChannels.jsx'

const TABS = ['Overview', 'Campaigns', 'Templates', 'Lead Sources', 'Follow-ups']

const tooltipStyle = {
  border: '1px solid #EBEBEB',
  borderRadius: 8,
  fontSize: 12,
  boxShadow: '0 8px 24px rgba(0,0,0,0.08)',
}

export default function Analytics() {
  const { id } = useParams()
  const scoped = id ? campaignById(id) : null
  const [tab, setTab] = useState('Overview')

  return (
    <div className="mx-auto max-w-[1280px] p-6">
      {/* Scoped-campaign banner when arriving from /campaigns/:id */}
      {scoped && (
        <div className="mb-4 flex items-center gap-1.5 text-sm text-muted">
          <Link to="/campaigns" className="hover:text-ink">Campaigns</Link>
          <ChevronRight size={14} className="text-faint" />
          <span className="font-medium text-ink">{scoped.name}</span>
          <Tag tone="info" className="ml-2">Campaign analytics</Tag>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-title font-semibold text-ink">{scoped ? scoped.name : 'Analytics'}</h1>
        <div className="flex items-center gap-2">
          <button className="inline-flex h-8 items-center gap-1.5 rounded border border-line-mid bg-white px-2.5 text-sm text-muted hover:bg-hover">
            Last 30 days <span className="text-faint">▾</span>
          </button>
          <button className="inline-flex h-8 items-center gap-1.5 rounded border border-line-mid bg-white px-2.5 text-sm text-muted hover:bg-hover">
            <Download size={14} /> Export
          </button>
        </div>
      </div>

      <div className="mt-4">
        <Tabs tabs={TABS} active={tab} onChange={setTab} />
      </div>

      <div className="mt-5">
        {tab === 'Overview' && <Overview />}
        {tab === 'Campaigns' && <CampaignsTab />}
        {tab === 'Templates' && <TemplatesTab />}
        {tab === 'Lead Sources' && <SourcesTab />}
        {tab === 'Follow-ups' && <FollowupsTab />}
      </div>
    </div>
  )
}

function Overview() {
  return (
    <div className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-6">
        <StatCard label="Emails sent" value="38,210" delta="14%" />
        <StatCard label="Open rate" value="57%" delta="2.1%" />
        <StatCard label="Reply rate" value="7.4%" delta="1.2%" />
        <StatCard label="Click rate" value="3.1%" delta="0.4%" deltaTone="danger" />
        <StatCard label="Conversion rate" value="2.6%" delta="0.5%" />
        <StatCard label="Unsubscribe" value="0.4%" delta="0.1%" deltaTone="danger" />
      </div>

      {/* AI recommendations + weekly summary */}
      <div className="grid gap-5 lg:grid-cols-3">
        <AiRecsPanel />
        <Card title="This week" className="lg:col-span-1">
          <div className="flex items-start gap-2.5">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-accent-soft text-accent"><Sparkles size={16} /></span>
            <p className="text-sm leading-relaxed text-ink">{weeklyAiSummary}</p>
          </div>
        </Card>
      </div>

      <div className="grid gap-5 lg:grid-cols-3">
        <Card title="Emails sent vs opens vs replies" className="lg:col-span-2">
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={sendSeries} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
                <defs>
                  <linearGradient id="g-sent" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#3E63DD" stopOpacity={0.18} />
                    <stop offset="100%" stopColor="#3E63DD" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#EBEBEB" vertical={false} />
                <XAxis dataKey="day" tick={{ fontSize: 11, fill: '#666' }} axisLine={{ stroke: '#EBEBEB' }} tickLine={false} />
                <YAxis tick={{ fontSize: 11, fill: '#666' }} axisLine={false} tickLine={false} />
                <Tooltip contentStyle={tooltipStyle} />
                <Area type="monotone" dataKey="sent" stroke="#3E63DD" strokeWidth={2} fill="url(#g-sent)" name="Sent" />
                <Line type="monotone" dataKey="opens" stroke="#2A7E3B" strokeWidth={2} dot={false} name="Opens" />
                <Line type="monotone" dataKey="replies" stroke="#999999" strokeWidth={2} dot={false} name="Replies" />
                <Legend wrapperStyle={{ fontSize: 12 }} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card title="Replies by classification">
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={repliesByClass} layout="vertical" margin={{ top: 4, right: 12, left: 8, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#EBEBEB" horizontal={false} />
                <XAxis type="number" tick={{ fontSize: 11, fill: '#666' }} axisLine={false} tickLine={false} />
                <YAxis dataKey="name" type="category" width={92} tick={{ fontSize: 11, fill: '#666' }} axisLine={false} tickLine={false} />
                <Tooltip contentStyle={tooltipStyle} cursor={{ fill: '#F4F4F4' }} />
                <Bar dataKey="value" radius={[0, 4, 4, 0]} barSize={18}>
                  {repliesByClass.map((d) => (
                    <Cell key={d.name} fill={d.tone} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
      </div>

      {/* Recent tracked events */}
      <Card title="Recent tracked events" noPad>
        <table className="w-full text-sm">
          <thead className="bg-page text-tiny text-muted">
            <tr className="border-b border-line">
              <th className="px-4 py-2.5 text-left font-medium">Lead</th>
              <th className="px-3 py-2.5 text-left font-medium">Event</th>
              <th className="px-3 py-2.5 text-left font-medium">Campaign</th>
              <th className="px-3 py-2.5 text-left font-medium">Timestamp</th>
            </tr>
          </thead>
          <tbody>
            {trackedEvents.map((e, i) => (
              <tr key={i} className="border-b border-line last:border-0 hover:bg-hover">
                <td className="px-4 py-2.5 font-medium text-ink">{e.lead}</td>
                <td className="px-3 py-2.5"><Tag tone={e.event === 'Replied' ? 'success' : e.event === 'Unsubscribed' ? 'danger' : e.event === 'Out of office' ? 'info' : 'neutral'}>{e.event}</Tag></td>
                <td className="px-3 py-2.5 text-muted">{e.campaign}</td>
                <td className="px-3 py-2.5 font-mono text-tiny text-muted">{e.time}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <FutureChannels title="Channel performance · future" />
    </div>
  )
}

function AiRecsPanel() {
  const navigate = useNavigate()
  const [dismissed, setDismissed] = useState([])
  const [review, setReview] = useState(null)
  const [applied, setApplied] = useState(false)
  const [toast, showToast] = useToast()
  const live = aiRecommendations.filter((r) => !dismissed.includes(r.kind))

  return (
    <Card title="AI recommendations" className="lg:col-span-2">
      <div className="space-y-2.5">
        {live.map((r) => (
          <div key={r.kind} className="flex items-start justify-between gap-3 rounded-md border border-line p-3">
            <div className="flex items-start gap-2.5">
              <Tag tone={r.tone}>{r.kind}</Tag>
              <p className="text-sm text-ink">{r.text}</p>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              {r.kind === 'Generate' ? (
                <Button size="sm" variant="secondary" onClick={() => navigate('/campaigns/new/ai/summary')}>Generate variants</Button>
              ) : r.kind === 'Apply' ? (
                <Button size="sm" variant="secondary" onClick={() => setApplied(true)}>Apply test</Button>
              ) : (
                <Button size="sm" variant="ghost" onClick={() => setReview(r)}>Review</Button>
              )}
              <button onClick={() => setDismissed((d) => [...d, r.kind])} className="rounded p-1 text-faint hover:bg-hover hover:text-ink" title="Dismiss"><X size={14} /></button>
            </div>
          </div>
        ))}
        {dismissed.length > 0 && <div className="text-tiny text-muted">Dismissed this week: {dismissed.length}</div>}
        {!live.length && <div className="py-4 text-center text-sm text-muted">All recommendations handled. 🎉</div>}
      </div>

      {review && (
        <Modal title={`${review.kind} — evidence`} onClose={() => setReview(null)} width="max-w-md" footer={<><Button variant="secondary" onClick={() => setReview(null)}>Close</Button><Button variant="primary" onClick={() => { setReview(null); showToast('Recommendation applied') }}>{review.action}</Button></>}>
          <p className="mb-3 text-sm text-ink">{review.text}</p>
          <div className="grid grid-cols-2 gap-2 text-sm">
            {[['Opens', '38%'], ['Replies', '2.1%'], ['Conversions', '0'], ['Unsubscribe', '0.9%']].map(([k, v]) => (
              <div key={k} className="rounded-md border border-line bg-page p-2.5"><div className="text-tiny text-muted">{k}</div><div className="font-semibold text-ink">{v}</div></div>
            ))}
          </div>
        </Modal>
      )}

      {applied && (
        <Modal title="Apply test" onClose={() => setApplied(false)} width="max-w-md" footer={<><Button variant="secondary" onClick={() => setApplied(false)}>Cancel</Button><Button variant="primary" onClick={() => { setApplied(false); showToast('Test applied — bottom 50% paused') }}>Confirm</Button></>}>
          <p className="text-sm text-ink">Pause the bottom 50% of templates and start testing 5 new variants generated from your top performers?</p>
        </Modal>
      )}
      {toast && <Toast>{toast}</Toast>}
    </Card>
  )
}

function Sparkline({ data, color }) {
  const pts = data.map((v, i) => `${(i / (data.length - 1)) * 60},${20 - (v / Math.max(...data)) * 18}`).join(' ')
  return (
    <svg width="60" height="20" className="overflow-visible">
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.5" />
    </svg>
  )
}

function CampaignsTab() {
  const spark = {
    'q3-directory-outreach': [3, 5, 4, 7, 6, 9],
    'welcome-sequence': [6, 6, 7, 5, 6, 6],
    'dentist-re-engagement': [5, 4, 3, 4, 3, 2],
  }
  const rows = campaigns.filter((c) => c.sent)
  return (
    <Card noPad>
      <table className="w-full text-sm">
        <thead className="bg-page text-tiny text-muted">
          <tr className="border-b border-line">
            <th className="px-4 py-2.5 text-left font-medium">Campaign</th>
            <th className="px-3 py-2.5 text-right font-medium">Sent</th>
            <th className="px-3 py-2.5 text-right font-medium">Open %</th>
            <th className="px-3 py-2.5 text-right font-medium">Reply %</th>
            <th className="px-3 py-2.5 text-right font-medium">Interested</th>
            <th className="px-3 py-2.5 text-right font-medium">Unsubscribed</th>
            <th className="px-4 py-2.5 text-left font-medium">Trend</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((c) => (
            <tr key={c.id} className="border-b border-line last:border-0 hover:bg-hover">
              <td className="px-4 py-3 font-medium text-ink">{c.name}</td>
              <td className="px-3 py-3 text-right text-muted">{c.sent.toLocaleString()}</td>
              <td className="px-3 py-3 text-right text-muted">{c.open}%</td>
              <td className="px-3 py-3 text-right text-muted">{c.reply}%</td>
              <td className="px-3 py-3 text-right text-muted">{c.interested}</td>
              <td className="px-3 py-3 text-right text-muted">{c.unsub}</td>
              <td className="px-4 py-3"><Sparkline data={spark[c.id] || [4, 5, 4, 6, 5, 7]} color="#3E63DD" /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  )
}

function TemplatesTab() {
  const perf = [62, 48, 39, 55, 44]
  const reply = [9.1, 7.8, 5.2, 8.4, 6.0]
  const conv = [3, 1, 0, 2, 1]
  return (
    <div className="space-y-4">
      <div className="rounded-md bg-info-bg p-3 text-sm text-info-text">
        <span className="font-medium">AI note:</span> {conversionNote}
      </div>
      <Card noPad>
        <table className="w-full text-sm">
          <thead className="bg-page text-tiny text-muted">
            <tr className="border-b border-line">
              <th className="px-4 py-2.5 text-left font-medium">Template</th>
              <th className="px-3 py-2.5 text-right font-medium">Uses</th>
              <th className="px-3 py-2.5 text-right font-medium">Open %</th>
              <th className="px-3 py-2.5 text-right font-medium">Reply %</th>
              <th className="px-3 py-2.5 text-right font-medium">Conversions</th>
            </tr>
          </thead>
          <tbody>
            {templates.map((t, i) => (
              <tr key={t.id} className="border-b border-line last:border-0 hover:bg-hover">
                <td className="px-4 py-3 font-medium text-ink">{t.name}</td>
                <td className="px-3 py-3 text-right text-muted">{t.usedIn}</td>
                <td className="px-3 py-3 text-right text-muted">{perf[i]}%</td>
                <td className="px-3 py-3 text-right text-muted">{reply[i]}%</td>
                <td className="px-3 py-3 text-right font-medium text-ink">{conv[i]}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
      <Card title="Open rate vs conversions" bodyClass="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-tiny text-muted">
            <tr className="border-b border-line"><th className="px-2 py-2 text-left font-medium">Template</th><th className="px-2 py-2 text-right font-medium">Open %</th><th className="px-2 py-2 text-right font-medium">Conversions</th></tr>
          </thead>
          <tbody>
            {conversionTemplates.map((c) => (
              <tr key={c.name} className="border-b border-line last:border-0"><td className="px-2 py-2 text-ink">{c.name}</td><td className="px-2 py-2 text-right text-muted">{c.open}%</td><td className="px-2 py-2 text-right font-medium text-ink">{c.conversions}</td></tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  )
}

function SourcesTab() {
  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <Card title="Leads by source">
        <div className="h-72">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie data={leadSources} dataKey="leads" nameKey="name" innerRadius={56} outerRadius={92} paddingAngle={2}>
                {leadSources.map((d) => (
                  <Cell key={d.name} fill={d.tone} />
                ))}
              </Pie>
              <Tooltip contentStyle={tooltipStyle} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
            </PieChart>
          </ResponsiveContainer>
        </div>
      </Card>
      <Card title="Reply rate by source" noPad>
        <table className="w-full text-sm">
          <thead className="bg-page text-tiny text-muted">
            <tr className="border-b border-line">
              <th className="px-4 py-2.5 text-left font-medium">Source</th>
              <th className="px-3 py-2.5 text-right font-medium">Leads</th>
              <th className="px-3 py-2.5 text-right font-medium">Reply %</th>
            </tr>
          </thead>
          <tbody>
            {leadSources.map((s) => (
              <tr key={s.name} className="border-b border-line last:border-0 hover:bg-hover">
                <td className="px-4 py-3">
                  <span className="flex items-center gap-2 font-medium text-ink">
                    <span className="h-2.5 w-2.5 rounded-full" style={{ background: s.tone }} /> {s.name}
                  </span>
                </td>
                <td className="px-3 py-3 text-right text-muted">{s.leads.toLocaleString()}</td>
                <td className="px-3 py-3 text-right text-muted">{s.reply}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  )
}

function FollowupsTab() {
  return (
    <Card title="Performance by sequence step">
      <p className="mb-3 text-tiny text-muted">Where replies happen across the follow-up sequence.</p>
      <div className="h-72">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={followupFunnel} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#EBEBEB" vertical={false} />
            <XAxis dataKey="step" tick={{ fontSize: 11, fill: '#666' }} axisLine={{ stroke: '#EBEBEB' }} tickLine={false} />
            <YAxis tick={{ fontSize: 11, fill: '#666' }} axisLine={false} tickLine={false} />
            <Tooltip contentStyle={tooltipStyle} cursor={{ fill: '#F4F4F4' }} />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            <Bar dataKey="sent" fill="#DCE3FB" radius={[4, 4, 0, 0]} name="Sent" barSize={40} />
            <Bar dataKey="replies" fill="#3E63DD" radius={[4, 4, 0, 0]} name="Replies" barSize={40} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </Card>
  )
}
