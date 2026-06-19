import { useState } from 'react'
import { useSearchParams, useNavigate } from 'react-router-dom'
import {
  Building2,
  Mail,
  Users as UsersIcon,
  Palette,
  CreditCard,
  Plus,
  UploadCloud,
  Sparkles,
  Plug,
  Radio,
  Copy,
  Check,
  Eye,
  PlayCircle,
} from 'lucide-react'
import {
  Card,
  Field,
  Input,
  Select,
  Tag,
  Button,
  Toggle,
  Progress,
  Modal,
  Drawer,
  Avatar,
  Callout,
  Banner,
  CopyButton,
  Toast,
  useToast,
  cx,
} from '../components/ui.jsx'
import AiMemoryForm from '../components/AiMemoryForm.jsx'
import ReplyRouting from '../components/ReplyRouting.jsx'
import FutureChannels from '../components/FutureChannels.jsx'
import { senders } from '../data/mock.js'
import {
  senderPool,
  totalSenders,
  rampStages,
  replyClasses,
  signalRules,
  saasSetup,
  usage,
} from '../data/mock2.js'

const SUBNAV = [
  { key: 'Workspace', slug: 'workspace', icon: Building2 },
  { key: 'AI Memory', slug: 'ai-memory', icon: Sparkles },
  { key: 'Sender accounts', slug: 'senders', icon: Mail },
  { key: 'Team', slug: 'team', icon: UsersIcon },
  { key: 'Brand', slug: 'brand', icon: Palette },
  { key: 'Billing', slug: 'billing', icon: CreditCard },
  { key: 'Integrations', slug: 'integrations', icon: Plug },
  { key: 'Signals', slug: 'signals', icon: Radio },
]
const slugToKey = (slug) => (SUBNAV.find((s) => s.slug === slug) || SUBNAV[0]).key

const TEAM = [
  { name: 'Yakin Shah', email: 'yakin@businesslab.com', role: 'Owner', status: 'Active' },
  { name: 'Riya Mehta', email: 'riya@businesslab.com', role: 'Admin', status: 'Active' },
  { name: 'Dev Kapoor', email: 'dev@businesslab.com', role: 'Member', status: 'Active' },
  { name: 'Sam Ortiz', email: 'sam@businesslab.com', role: 'Member', status: 'Invited' },
]

export default function Settings() {
  const [params, setParams] = useSearchParams()
  const tab = slugToKey(params.get('tab'))
  const setTab = (key) => {
    const slug = SUBNAV.find((s) => s.key === key)?.slug
    setParams(slug && slug !== 'workspace' ? { tab: slug } : {})
  }
  const [invite, setInvite] = useState(false)
  const [toast, showToast] = useToast()

  return (
    <div className="mx-auto max-w-[1100px] p-6">
      <div className="grid gap-6 md:grid-cols-[200px_1fr]">
        {/* Sub-nav */}
        <nav className="space-y-0.5">
          {SUBNAV.map((s) => (
            <button
              key={s.key}
              onClick={() => setTab(s.key)}
              className={cx(
                'flex w-full items-center gap-2.5 rounded px-2.5 py-2 text-sm transition-colors',
                tab === s.key ? 'bg-accent-soft font-medium text-accent' : 'text-muted hover:bg-hover hover:text-ink',
              )}
            >
              <s.icon size={16} strokeWidth={1.9} /> {s.key}
            </button>
          ))}
        </nav>

        {/* Content */}
        <div className="space-y-5">
          {tab === 'Workspace' && <WorkspaceTab />}
          {tab === 'AI Memory' && <AiMemoryTab onToast={showToast} />}
          {tab === 'Sender accounts' && <SendersTab onToast={showToast} />}
          {tab === 'Team' && <TeamTab onInvite={() => setInvite(true)} />}
          {tab === 'Brand' && <BrandTab onToast={showToast} />}
          {tab === 'Billing' && <BillingTab />}
          {tab === 'Integrations' && <IntegrationsTab onToast={showToast} />}
          {tab === 'Signals' && <SignalsTab onToast={showToast} />}
        </div>
      </div>

      {invite && (
        <Modal
          title="Invite member"
          onClose={() => setInvite(false)}
          width="max-w-md"
          footer={
            <>
              <Button variant="secondary" onClick={() => setInvite(false)}>Cancel</Button>
              <Button variant="primary" onClick={() => setInvite(false)}>Send invite</Button>
            </>
          }
        >
          <div className="space-y-4">
            <Field label="Email"><Input placeholder="name@company.com" /></Field>
            <Field label="Role">
              <Select defaultValue="Member"><option>Admin</option><option>Member</option></Select>
            </Field>
          </div>
        </Modal>
      )}
      {toast && <Toast>{toast}</Toast>}
    </div>
  )
}

function WorkspaceTab() {
  return (
    <>
    <Card title="Workspace">
      <div className="space-y-4">
        <Field label="Workspace name"><Input defaultValue="Business Lab" /></Field>
        <Field label="Logo">
          <button className="flex w-full items-center gap-3 rounded-md border border-dashed border-line-mid bg-panel px-4 py-3 text-left text-muted hover:bg-hover">
            <UploadCloud size={20} strokeWidth={1.6} />
            <span className="text-sm">Upload a logo (PNG or SVG)</span>
          </button>
        </Field>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Timezone">
            <Select defaultValue="Asia/Kolkata (GMT+5:30)">
              <option>Asia/Kolkata (GMT+5:30)</option>
              <option>America/New_York (GMT-5)</option>
              <option>Europe/London (GMT+0)</option>
            </Select>
          </Field>
          <Field label="Default sending window">
            <Select defaultValue="9:00 AM – 5:00 PM">
              <option>9:00 AM – 5:00 PM</option>
              <option>8:00 AM – 6:00 PM</option>
              <option>All day</option>
            </Select>
          </Field>
        </div>
        <div className="flex justify-end"><Button variant="primary">Save changes</Button></div>
      </div>
    </Card>
    <FutureChannels title="Channels" />
    </>
  )
}

function AiMemoryTab({ onToast }) {
  const [autos, setAutos] = useState(() => Object.fromEntries(replyClasses.map((c) => [c.key, c.auto])))
  return (
    <>
      <Card title="AI business memory">
        <AiMemoryForm onToast={onToast} />
      </Card>
      <Card title="Reply rules">
        <p className="mb-3 text-tiny text-muted">
          The AI drafts replies from your business memory and learns from your edits. After 10 clean approvals in a
          category, you can enable auto-reply for that category.
        </p>
        <div className="space-y-2">
          {replyClasses.map((c) => {
            const ready = c.approvals >= 10
            return (
              <div key={c.key} className="flex items-center justify-between rounded-md border border-line px-3 py-2.5">
                <div className="flex items-center gap-3">
                  <Tag tone={c.tone} dot>{c.key}</Tag>
                  <span className="text-tiny text-muted">Approved without edits: {c.approvals} of 10</span>
                </div>
                <div className="flex items-center gap-2">
                  {autos[c.key] && <Tag tone="success">Auto mode on</Tag>}
                  <Toggle
                    checked={!!autos[c.key]}
                    onChange={(v) => {
                      if (v && !ready) return onToast?.('Needs 10 clean approvals before auto-reply')
                      setAutos((a) => ({ ...a, [c.key]: v }))
                      onToast?.(v ? `Auto-reply enabled for ${c.key}` : `Auto-reply off for ${c.key}`)
                    }}
                  />
                </div>
              </div>
            )
          })}
        </div>
      </Card>
    </>
  )
}

function SendersTab({ onToast }) {
  const [addOpen, setAddOpen] = useState(false)
  const [detail, setDetail] = useState(null)
  return (
    <>
      <Card
        title={`Global sender pool · ${senderPool.length} of ${totalSenders}`}
        actions={<Button size="sm" variant="secondary" icon={Plus} onClick={() => setAddOpen(true)}>Add sender</Button>}
        noPad
      >
        <table className="w-full text-sm">
          <thead className="bg-page text-tiny text-muted">
            <tr className="border-b border-line">
              <th className="px-4 py-2.5 text-left font-medium">Email</th>
              <th className="px-3 py-2.5 text-left font-medium">Provider</th>
              <th className="px-3 py-2.5 text-left font-medium">Status</th>
              <th className="px-3 py-2.5 text-right font-medium">Daily cap</th>
              <th className="px-3 py-2.5 text-left font-medium">Ramp stage</th>
              <th className="px-3 py-2.5 text-left font-medium">Last used</th>
              <th className="px-3 py-2.5 text-right font-medium">Campaigns</th>
            </tr>
          </thead>
          <tbody>
            {senderPool.map((s) => (
              <tr key={s.email} onClick={() => setDetail(s)} className="cursor-pointer border-b border-line last:border-0 hover:bg-hover">
                <td className="px-4 py-2.5 font-medium text-ink">{s.email}</td>
                <td className="px-3 py-2.5 text-muted">{s.provider}</td>
                <td className="px-3 py-2.5">
                  <Tag tone={s.status === 'Verified' ? 'success' : s.status === 'Warming' ? 'info' : 'warning'} dot>{s.status}</Tag>
                </td>
                <td className="px-3 py-2.5 text-right text-muted">{s.cap}/day</td>
                <td className="px-3 py-2.5"><Tag tone={s.ramp === 'Mature' ? 'success' : 'neutral'}>{s.ramp}</Tag></td>
                <td className="px-3 py-2.5 text-muted">{s.lastUsed}</td>
                <td className="px-3 py-2.5 text-right text-muted">{s.campaigns}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <ReplyRouting onToast={onToast} />

      <Card title="Domain readiness">
        <div className="space-y-3">
          <div className="flex items-center justify-between text-sm">
            <span className="font-medium text-ink">businesslab.com</span>
            <span className="font-semibold text-warning-text">60%</span>
          </div>
          <Progress value={60} tone="warning" />
          <div className="grid gap-2 sm:grid-cols-3">
            {[
              { n: 'SPF', tone: 'success', label: 'Verified' },
              { n: 'DKIM', tone: 'warning', label: 'Action needed' },
              { n: 'DMARC', tone: 'neutral', label: 'Not set up' },
            ].map((r) => (
              <div key={r.n} className="flex items-center justify-between rounded-md border border-line bg-page px-3 py-2">
                <span className="text-sm font-medium text-ink">{r.n}</span>
                <Tag tone={r.tone} dot>{r.label}</Tag>
              </div>
            ))}
          </div>
        </div>
      </Card>

      {addOpen && (
        <Modal
          title="Add sender account"
          onClose={() => setAddOpen(false)}
          width="max-w-md"
          footer={<Button variant="secondary" onClick={() => setAddOpen(false)}>Close</Button>}
        >
          <p className="mb-3 text-sm text-muted">Connect a new sending address to your global pool.</p>
          <div className="space-y-2">
            {['Google', 'Microsoft', 'SMTP'].map((p) => (
              <button
                key={p}
                onClick={() => { setAddOpen(false); onToast?.(`${p} connection started`) }}
                className="flex w-full items-center gap-3 rounded-md border border-line-mid bg-white px-3 py-2.5 text-left hover:bg-hover"
              >
                <span className="flex h-8 w-8 items-center justify-center rounded-md bg-panel text-muted"><Mail size={16} /></span>
                <span className="text-sm font-medium text-ink">Connect with {p}</span>
              </button>
            ))}
          </div>
        </Modal>
      )}

      {detail && (
        <Drawer title={detail.email} onClose={() => setDetail(null)}>
          <div className="space-y-3 text-sm">
            <Row k="Provider" v={detail.provider} />
            <Row k="Status" v={<Tag tone={detail.status === 'Verified' ? 'success' : 'warning'} dot>{detail.status}</Tag>} />
            <Row k="Daily cap" v={`${detail.cap}/day`} />
            <Row k="Ramp stage" v={detail.ramp} />
            <Row k="Last used" v={detail.lastUsed} />
            <Row k="Campaigns assigned" v={detail.campaigns} />
          </div>
          <div className="mt-5">
            <div className="mb-2 text-sm font-medium text-ink">Ramp schedule</div>
            <div className="space-y-1.5">
              {rampStages.map((r) => (
                <div key={r.stage} className="flex items-center justify-between rounded border border-line px-3 py-1.5 text-tiny">
                  <span className="font-medium text-ink">{r.stage}</span>
                  <span className="text-muted">{r.range}</span>
                </div>
              ))}
            </div>
          </div>
        </Drawer>
      )}
    </>
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

function TeamTab({ onInvite }) {
  return (
    <Card title="Team members" actions={<Button size="sm" variant="secondary" icon={Plus} onClick={onInvite}>Invite member</Button>} noPad>
      <table className="w-full text-sm">
        <thead className="bg-page text-tiny text-muted">
          <tr className="border-b border-line">
            <th className="px-4 py-2.5 text-left font-medium">Member</th>
            <th className="px-3 py-2.5 text-left font-medium">Email</th>
            <th className="px-3 py-2.5 text-left font-medium">Role</th>
            <th className="px-3 py-2.5 text-left font-medium">Status</th>
          </tr>
        </thead>
        <tbody>
          {TEAM.map((m) => (
            <tr key={m.email} className="border-b border-line last:border-0">
              <td className="px-4 py-3">
                <span className="flex items-center gap-2.5"><Avatar name={m.name} size={26} /><span className="font-medium text-ink">{m.name}</span></span>
              </td>
              <td className="px-3 py-3 text-muted">{m.email}</td>
              <td className="px-3 py-3">
                <Select defaultValue={m.role} className="h-8 w-28"><option>Owner</option><option>Admin</option><option>Member</option></Select>
              </td>
              <td className="px-3 py-3"><Tag tone={m.status === 'Active' ? 'success' : 'warning'} dot>{m.status}</Tag></td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  )
}

function BrandTab({ onToast }) {
  const [preview, setPreview] = useState(null)
  return (
    <>
      <Card title="SaaS owner setup">
        <Tag tone="purple" className="mb-4">White-label · Super SaaS preview</Tag>
        <p className="mb-4 text-sm text-muted">Turn Business Lab into your own branded product and resell it to your customers.</p>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Public product name"><Input defaultValue={saasSetup.productName} /></Field>
          <Field label="Plan display name"><Input defaultValue={saasSetup.planName} /></Field>
          <Field label="Brand color">
            <div className="flex items-center gap-2">
              <span className="h-8 w-8 rounded border border-line" style={{ background: saasSetup.brandColor }} />
              <Input defaultValue={saasSetup.brandColor} className="w-32" />
            </div>
          </Field>
          <Field label="Support email"><Input defaultValue={saasSetup.supportEmail} /></Field>
          <Field label="Custom domain">
            <div className="flex items-center gap-2">
              <Input defaultValue={saasSetup.customDomain} className="flex-1" />
              <Tag tone="warning" dot>Pending DNS</Tag>
            </div>
          </Field>
          <Field label="Logo">
            <button className="flex w-full items-center gap-2 rounded-md border border-dashed border-line-mid bg-panel px-3 py-2 text-left text-sm text-muted hover:bg-hover">
              <UploadCloud size={16} /> Upload brand logo
            </button>
          </Field>
        </div>
        <Field label="About text"><Input defaultValue={saasSetup.about} /></Field>

        <div className="mt-5 border-t border-line pt-4">
          <div className="mb-2 text-sm font-medium text-ink">Preview</div>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="secondary" icon={Eye} onClick={() => setPreview('login')}>Preview login page</Button>
            <Button size="sm" variant="secondary" icon={Eye} onClick={() => setPreview('dashboard')}>Preview customer dashboard</Button>
            <Button size="sm" variant="secondary" icon={Eye} onClick={() => setPreview('footer')}>Preview email footer</Button>
            <Button size="sm" variant="primary" onClick={() => onToast?.('Brand preview updated')}>Publish brand changes</Button>
          </div>
        </div>
      </Card>

      {preview && (
        <Modal title={`Branded preview — ${preview}`} onClose={() => setPreview(null)} width="max-w-lg" footer={<Button variant="secondary" onClick={() => setPreview(null)}>Close</Button>}>
          <div className="rounded-lg border border-line bg-page p-6 text-center">
            <span className="inline-flex h-10 w-10 items-center justify-center rounded-lg text-white" style={{ background: saasSetup.brandColor }}>BL</span>
            <div className="mt-3 text-section font-semibold text-ink">{saasSetup.productName}</div>
            {preview === 'login' && <p className="mt-2 text-sm text-muted">Branded login page on {saasSetup.customDomain}. Your customers never see Business Lab.</p>}
            {preview === 'dashboard' && <p className="mt-2 text-sm text-muted">Customer dashboard rendered in your brand color with your product name.</p>}
            {preview === 'footer' && <p className="mt-2 text-sm text-muted">Email footer: “Sent via {saasSetup.productName} · {saasSetup.supportEmail}”.</p>}
          </div>
        </Modal>
      )}
    </>
  )
}

function BillingTab() {
  const rows = [
    { l: 'Leads', u: usage.leads },
    { l: 'Emails sent', u: usage.emails },
    { l: 'Active campaigns', u: usage.campaigns },
    { l: 'Sender accounts', u: usage.senders },
    { l: 'AI campaign generations', u: usage.ai },
  ]
  return (
    <>
      <Card>
        <div className="flex items-start justify-between">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-section font-semibold text-ink">Growth</span>
              <Tag tone="info">Current plan</Tag>
            </div>
            <p className="mt-1 text-sm text-muted">$49 / month · renews July 1, 2026</p>
          </div>
          <Button variant="secondary">Manage plan</Button>
        </div>
      </Card>
      <Card title="Usage this period">
        <div className="space-y-4">
          {rows.map((r) => (
            <div key={r.l}>
              <div className="mb-1.5 flex items-center justify-between text-sm">
                <span className="text-ink">{r.l}</span>
                <span className="text-muted">{r.u.used.toLocaleString()} / {r.u.max.toLocaleString()}</span>
              </div>
              <Progress value={(r.u.used / r.u.max) * 100} tone={r.u.used / r.u.max > 0.9 ? 'warning' : 'accent'} />
            </div>
          ))}
        </div>
      </Card>
    </>
  )
}

function IntegrationsTab({ onToast }) {
  const [goalOpen, setGoalOpen] = useState(false)
  return (
    <>
      <Card title="Conversion goal signals">
        <p className="mb-3 text-sm text-muted">Feed conversion events from your systems so analytics can judge campaigns by outcomes, not just opens.</p>
        <div className="space-y-3 rounded-md border border-line bg-page p-4 text-sm">
          <Row k="Event name" v={<span className="font-mono">paid_listing_upgraded</span>} />
          <Row k="Match by" v="email" />
          <Row k="Source" v="Brilliant Directories API" />
        </div>
        <div className="mt-3 flex gap-2">
          <Button size="sm" variant="secondary" onClick={() => setGoalOpen(true)}>Set up goal signal</Button>
          <Button size="sm" variant="ghost" onClick={() => onToast?.('Sample conversion received')}>Test event</Button>
        </div>
      </Card>

      <Card title="REST API">
        <div className="space-y-3">
          <div>
            <div className="mb-1.5 text-sm font-medium text-ink">Lead ingest endpoint</div>
            <div className="flex items-center justify-between rounded-md border border-line bg-page px-3 py-2 font-mono text-tiny text-ink">
              POST https://api.businesslab.com/v1/leads
              <CopyButton onCopied={() => onToast?.('Endpoint copied')} />
            </div>
          </div>
          <div>
            <div className="mb-1.5 text-sm font-medium text-ink">Conversion event endpoint</div>
            <div className="flex items-center justify-between rounded-md border border-line bg-page px-3 py-2 font-mono text-tiny text-ink">
              POST https://api.businesslab.com/v1/events
              <CopyButton onCopied={() => onToast?.('Endpoint copied')} />
            </div>
          </div>
        </div>
      </Card>

      {goalOpen && (
        <Modal title="Set up goal signal" onClose={() => setGoalOpen(false)} width="max-w-lg" footer={<><Button variant="secondary" onClick={() => setGoalOpen(false)}>Cancel</Button><Button variant="primary" onClick={() => { setGoalOpen(false); onToast?.('Goal signal saved') }}>Save</Button></>}>
          <div className="space-y-4">
            <Field label="Goal type"><Select defaultValue="Custom API event"><option>Book a call</option><option>Paid signup</option><option>Upgrade listing</option><option>Website traffic</option><option>Custom API event</option></Select></Field>
            <Field label="Event name"><Input defaultValue="paid_listing_upgraded" /></Field>
            <div>
              <div className="mb-1.5 text-sm font-medium text-ink">Sample payload</div>
              <pre className="overflow-x-auto rounded-md border border-line bg-ink2 p-3 text-tiny leading-relaxed text-white">{`POST /v1/events
{ "event": "paid_listing_upgraded",
  "email": "anita@brightdental.com" }`}</pre>
            </div>
          </div>
        </Modal>
      )}
    </>
  )
}

function SignalsTab({ onToast }) {
  const [addOpen, setAddOpen] = useState(false)
  const [signaled, setSignaled] = useState(false)
  return (
    <>
      <Card title="Signal rules" actions={<Button size="sm" variant="secondary" icon={Plus} onClick={() => setAddOpen(true)}>Add signal rule</Button>}>
        <p className="mb-3 text-sm text-muted">React automatically when external systems send a signal about a lead.</p>
        <div className="space-y-2">
          {signalRules.map((r) => (
            <div key={r.signal} className="flex items-center justify-between rounded-md border border-line px-3 py-2.5">
              <div className="flex items-center gap-2">
                <span className="text-tiny text-muted">If</span>
                <span className="rounded bg-panel px-1.5 py-0.5 font-mono text-tiny text-ink">{r.signal}</span>
                <span className="text-tiny text-muted">→</span>
                <span className="text-sm text-ink">{r.action}</span>
              </div>
              <Tag tone={r.tone} dot>active</Tag>
            </div>
          ))}
        </div>
        <div className="mt-3 flex gap-2">
          <CopyButton label="Copy API endpoint" onCopied={() => onToast?.('Signal endpoint copied')} />
          <Button size="sm" variant="ghost" icon={PlayCircle} onClick={() => { setSignaled(true); onToast?.('Signal simulated for David Cohen') }}>Simulate signal</Button>
        </div>
      </Card>

      <Card title="Simulation preview — David Cohen">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-md border border-line p-3">
            <div className="text-tiny text-muted">Before signal</div>
            <div className="mt-1 text-sm text-ink">Status: New</div>
            <div className="text-sm text-ink">Campaign: Q3 Directory Outreach</div>
          </div>
          <div className={cx('rounded-md border p-3', signaled ? 'border-success-bg bg-success-bg' : 'border-line')}>
            <div className="text-tiny text-muted">After <span className="font-mono">signed_up</span></div>
            <div className="mt-1 text-sm text-ink">Status: {signaled ? 'Signed up' : '—'}</div>
            <div className="text-sm text-ink">Outreach: {signaled ? 'Stopped' : '—'} · Nurture: {signaled ? 'Started' : '—'}</div>
          </div>
        </div>
      </Card>

      {addOpen && (
        <Modal title="Add signal rule" onClose={() => setAddOpen(false)} width="max-w-lg" footer={<><Button variant="secondary" onClick={() => setAddOpen(false)}>Cancel</Button><Button variant="primary" onClick={() => { setAddOpen(false); onToast?.('Signal rule added') }}>Add rule</Button></>}>
          <div className="space-y-4">
            <Field label="When this signal is received"><Input placeholder="e.g. signed_up" /></Field>
            <Field label="Do this">
              <Select defaultValue="Stop current outreach campaign">
                <option>Stop current outreach campaign</option>
                <option>Start profile-completion nurture</option>
                <option>Skip employment reminder</option>
                <option>Move to upsell sequence</option>
              </Select>
            </Field>
          </div>
        </Modal>
      )}
    </>
  )
}
