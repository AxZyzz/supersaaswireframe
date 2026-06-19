import { useState } from 'react'
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  CartesianGrid,
  Tooltip,
} from 'recharts'
import { Card, StatCard, Tag, Drawer, Button } from '../components/ui.jsx'
import { adminLogs, sendSeries } from '../data/mock.js'
import { adminWorkspaces as baseWorkspaces } from '../data/mock.js'
import { partnerWorkspace } from '../data/mock2.js'

const adminWorkspaces = [
  ...baseWorkspaces.map((w) => ({ ...w, whitelabel: w.ws === 'NorthStar Directory' ? 'Live' : '—' })),
  partnerWorkspace,
]

const SYSTEMS = [
  { name: 'Email queue', status: 'Healthy' },
  { name: 'API', status: 'Healthy' },
  { name: 'Tracking', status: 'Healthy' },
  { name: 'Webhooks', status: 'Degraded' },
]

const tooltipStyle = {
  border: '1px solid #EBEBEB',
  borderRadius: 8,
  fontSize: 12,
  boxShadow: '0 8px 24px rgba(0,0,0,0.08)',
}

export default function Admin() {
  const [ws, setWs] = useState(null)
  return (
    <div className="mx-auto max-w-[1280px] p-6">
      <div className="flex items-center gap-2">
        <h1 className="text-title font-semibold text-ink">Admin</h1>
        <Tag tone="purple">Operator view</Tag>
      </div>
      <p className="mt-0.5 text-sm text-muted">Platform-wide monitoring for Business Lab operators.</p>

      {/* Stat cards */}
      <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Workspaces / users" value="128 / 412" delta="9 new this week" />
        <StatCard label="Active campaigns" value="86" sub="14 sending now" />
        <StatCard label="Emails sent (platform)" value="1.24M" delta="11%" />
        <StatCard label="Errors (24h)" value="7" delta="3 fewer" />
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-3">
        {/* Workspaces table */}
        <Card title="Workspaces" className="lg:col-span-2" noPad>
          <table className="w-full text-sm">
            <thead className="bg-page text-tiny text-muted">
              <tr className="border-b border-line">
                <th className="px-4 py-2.5 text-left font-medium">Workspace</th>
                <th className="px-3 py-2.5 text-left font-medium">Owner</th>
                <th className="px-3 py-2.5 text-left font-medium">Plan</th>
                <th className="px-3 py-2.5 text-right font-medium">Leads</th>
                <th className="px-3 py-2.5 text-right font-medium">Sent</th>
                <th className="px-3 py-2.5 text-left font-medium">White-label</th>
                <th className="px-3 py-2.5 text-left font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {adminWorkspaces.map((w) => (
                <tr key={w.ws} onClick={() => setWs(w)} className="cursor-pointer border-b border-line last:border-0 hover:bg-hover">
                  <td className="px-4 py-2.5 font-medium text-ink">{w.ws}</td>
                  <td className="px-3 py-2.5 text-muted">{w.owner}</td>
                  <td className="px-3 py-2.5"><Tag tone={w.plan === 'Scale' ? 'purple' : w.plan === 'Growth' ? 'info' : 'neutral'}>{w.plan}</Tag></td>
                  <td className="px-3 py-2.5 text-right text-muted">{w.leads.toLocaleString()}</td>
                  <td className="px-3 py-2.5 text-right text-muted">{w.sent.toLocaleString()}</td>
                  <td className="px-3 py-2.5">{w.whitelabel === 'Live' ? <Tag tone="purple" dot>Live</Tag> : <span className="text-faint">—</span>}</td>
                  <td className="px-3 py-2.5"><Tag tone={w.status === 'Active' ? 'success' : 'danger'} dot>{w.status}</Tag></td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>

        {/* System status */}
        <Card title="System status">
          <ul className="space-y-2.5">
            {SYSTEMS.map((s) => (
              <li key={s.name} className="flex items-center justify-between">
                <span className="text-sm text-ink">{s.name}</span>
                <span className="flex items-center gap-1.5 text-tiny">
                  <span className={s.status === 'Healthy' ? 'h-2 w-2 rounded-full bg-success-text' : 'h-2 w-2 rounded-full bg-warning-text'} />
                  <span className={s.status === 'Healthy' ? 'text-success-text' : 'text-warning-text'}>{s.status}</span>
                </span>
              </li>
            ))}
          </ul>
        </Card>
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-3">
        {/* Sending activity */}
        <Card title="Sending activity (platform)" className="lg:col-span-2">
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={sendSeries} margin={{ top: 8, right: 8, left: -20, bottom: 0 }}>
                <defs>
                  <linearGradient id="adm" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#3E63DD" stopOpacity={0.18} />
                    <stop offset="100%" stopColor="#3E63DD" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#EBEBEB" vertical={false} />
                <XAxis dataKey="day" tick={{ fontSize: 11, fill: '#666' }} axisLine={{ stroke: '#EBEBEB' }} tickLine={false} />
                <Tooltip contentStyle={tooltipStyle} />
                <Area type="monotone" dataKey="sent" stroke="#3E63DD" strokeWidth={2} fill="url(#adm)" name="Sent" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </Card>

        {/* Errors / logs */}
        <Card title="Errors & logs" noPad>
          <ul className="divide-y divide-line">
            {adminLogs.map((l, i) => (
              <li key={i} className="px-4 py-2.5">
                <div className="flex items-center justify-between">
                  <Tag tone={l.level === 'Error' ? 'danger' : 'warning'}>{l.level}</Tag>
                  <span className="font-mono text-tiny text-faint">{l.time}</span>
                </div>
                <p className="mt-1 text-tiny text-ink">{l.msg}</p>
                <p className="text-micro text-muted">{l.source}</p>
              </li>
            ))}
          </ul>
        </Card>
      </div>

      {ws && (
        <Drawer title={ws.ws} onClose={() => setWs(null)} width="max-w-md">
          <div className="space-y-2 text-sm">
            <Row k="Owner" v={ws.owner} />
            <Row k="Plan" v={<Tag tone={ws.plan === 'Scale' ? 'purple' : ws.plan === 'Growth' ? 'info' : 'neutral'}>{ws.plan}</Tag>} />
            <Row k="Status" v={<Tag tone={ws.status === 'Active' ? 'success' : 'danger'} dot>{ws.status}</Tag>} />
            <Row k="White-label" v={ws.whitelabel === 'Live' ? <Tag tone="purple" dot>Live</Tag> : '—'} />
            <Row k="Leads" v={ws.leads.toLocaleString()} />
            <Row k="Emails sent" v={ws.sent.toLocaleString()} />
          </div>
          <div className="mt-5">
            <div className="mb-2 text-sm font-medium text-ink">Brand</div>
            <div className="rounded-md border border-line bg-page p-3 text-center">
              <span className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-accent text-white">{ws.ws.slice(0, 2).toUpperCase()}</span>
              <div className="mt-2 text-sm font-medium text-ink">{ws.ws}</div>
              <div className="text-tiny text-muted">{ws.whitelabel === 'Live' ? 'Branded white-label workspace' : 'Default Business Lab branding'}</div>
            </div>
          </div>
          <div className="mt-4 flex gap-2">
            <Button size="sm" variant="secondary">View users</Button>
            <Button size="sm" variant="secondary">Usage report</Button>
          </div>
        </Drawer>
      )}
    </div>
  )
}

function Row({ k, v }) {
  return (
    <div className="flex items-center justify-between border-b border-line py-2">
      <span className="text-muted">{k}</span>
      <span className="font-medium text-ink">{v}</span>
    </div>
  )
}
