import { Link, useNavigate } from 'react-router-dom'
import {
  Reply,
  Check,
  Upload,
  Send,
  Tag as TagIcon,
  AlertTriangle,
  Inbox as InboxIcon,
  Users,
  Sparkles,
  ChevronRight,
} from 'lucide-react'
import { Card, StatCard, Tag, Progress, Button, cx } from '../components/ui.jsx'
import { campaigns, activity, campaignStatusTone, user } from '../data/mock.js'

const ICONS = { reply: Reply, check: Check, upload: Upload, send: Send, tag: TagIcon }

export default function Dashboard() {
  const navigate = useNavigate()
  return (
    <div className="mx-auto max-w-[1280px] p-6">
      {/* Greeting row */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-title font-semibold text-ink">Good morning, Yakin</h1>
          <p className="mt-0.5 text-sm text-muted">Thursday, June 19, 2026</p>
        </div>
        <button className="inline-flex h-8 items-center gap-1.5 rounded border border-line-mid bg-white px-2.5 text-sm text-muted hover:bg-hover">
          Last 30 days <span className="text-faint">▾</span>
        </button>
      </div>

      {/* Stat cards */}
      <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Total leads" value="12,480" delta="6% vs last month" />
        <StatCard label="Active campaigns" value="5" sub="2 sending now" />
        <StatCard label="Emails sent (30d)" value="38,210" delta="14% vs last month" />
        <StatCard label="Reply rate" value="7.4%" delta="1.2% vs last month" />
      </div>

      {/* Two-column */}
      <div className="mt-5 grid gap-5 lg:grid-cols-3">
        {/* Left (wider) */}
        <div className="space-y-5 lg:col-span-2">
          <Card
            title="Campaign status"
            actions={<Link to="/campaigns" className="text-tiny text-accent hover:underline">View all</Link>}
            noPad
          >
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line text-tiny text-muted">
                  <th className="px-4 py-2 text-left font-medium">Campaign</th>
                  <th className="px-3 py-2 text-left font-medium">Status</th>
                  <th className="px-3 py-2 text-right font-medium">Sent</th>
                  <th className="px-3 py-2 text-right font-medium">Open</th>
                  <th className="px-3 py-2 text-right font-medium">Reply</th>
                  <th className="px-4 py-2 text-left font-medium">Progress</th>
                </tr>
              </thead>
              <tbody>
                {campaigns.map((c) => (
                  <tr
                    key={c.id}
                    onClick={() => navigate(`/campaigns/${c.id}`)}
                    className="cursor-pointer border-b border-line last:border-0 hover:bg-hover"
                  >
                    <td className="px-4 py-2.5 font-medium text-ink">{c.name}</td>
                    <td className="px-3 py-2.5"><Tag tone={campaignStatusTone[c.status]} dot>{c.status}</Tag></td>
                    <td className="px-3 py-2.5 text-right text-muted">{c.sent ? c.sent.toLocaleString() : '—'}</td>
                    <td className="px-3 py-2.5 text-right text-muted">{c.open != null ? `${c.open}%` : '—'}</td>
                    <td className="px-3 py-2.5 text-right text-muted">{c.reply != null ? `${c.reply}%` : '—'}</td>
                    <td className="px-4 py-2.5"><Progress value={c.progress} className="w-24" /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>

          <Card title="Recent activity">
            <ul className="space-y-3.5">
              {activity.map((a, i) => {
                const Icon = ICONS[a.icon] || Check
                return (
                  <li key={i} className="flex items-start gap-3">
                    <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-panel text-muted">
                      <Icon size={14} strokeWidth={1.9} />
                    </span>
                    <div className="min-w-0">
                      <p className="text-sm text-ink">{a.text}</p>
                      <p className="text-tiny text-muted">{a.time}</p>
                    </div>
                  </li>
                )
              })}
            </ul>
          </Card>
        </div>

        {/* Right (narrower) */}
        <div className="space-y-5">
          <Card title="Alerts & to-dos">
            <ul className="space-y-3">
              <li className="flex items-start justify-between gap-2">
                <div className="flex items-start gap-2.5">
                  <AlertTriangle size={15} className="mt-0.5 text-warning-text" />
                  <div>
                    <p className="text-sm text-ink">DKIM not verified for businesslab.com</p>
                    <Tag tone="warning" className="mt-1">Deliverability risk</Tag>
                  </div>
                </div>
                <Button size="sm" variant="secondary" onClick={() => navigate('/settings')}>Fix</Button>
              </li>
              <li className="flex items-start gap-2.5 border-t border-line pt-3">
                <AlertTriangle size={15} className="mt-0.5 text-warning-text" />
                <div>
                  <p className="text-sm text-ink">Sender approaching daily limit</p>
                  <p className="text-tiny text-muted">outreach@businesslab.com · 46/50</p>
                </div>
              </li>
              <li className="flex items-start justify-between gap-2 border-t border-line pt-3">
                <div className="flex items-start gap-2.5">
                  <InboxIcon size={15} className="mt-0.5 text-accent" />
                  <p className="text-sm text-ink">3 replies need review</p>
                </div>
                <Button size="sm" variant="secondary" onClick={() => navigate('/inbox')}>Open</Button>
              </li>
            </ul>
          </Card>

          <Card title="Quick actions">
            <div className="grid gap-2">
              <Button variant="secondary" icon={Users} className="justify-start" onClick={() => navigate('/leads')}>
                Import leads
              </Button>
              <Button variant="secondary" icon={Sparkles} className="justify-start" onClick={() => navigate('/campaigns/new')}>
                New campaign
              </Button>
              <Button variant="secondary" icon={InboxIcon} className="justify-start" onClick={() => navigate('/inbox')}>
                Open inbox
              </Button>
            </div>
          </Card>
        </div>
      </div>
    </div>
  )
}
