import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ChevronDown, Copy } from 'lucide-react'
import OnboardingShell from '../../components/OnboardingShell.jsx'
import { Button, Card, Tag, Progress, cx } from '../../components/ui.jsx'

const CHECKS = [
  {
    name: 'SPF',
    desc: 'Authorizes our servers to send on your behalf.',
    status: { tone: 'success', label: 'Verified' },
    record: { type: 'TXT', host: '@', value: 'v=spf1 include:mail.businesslab.com ~all' },
  },
  {
    name: 'DKIM',
    desc: 'Cryptographically signs your emails so they aren’t flagged.',
    status: { tone: 'warning', label: 'Action needed' },
    record: { type: 'TXT', host: 'bl._domainkey', value: 'k=rsa; p=MIGfMA0GCSqGSIb3DQ…' },
  },
  {
    name: 'DMARC',
    desc: 'Tells inboxes what to do with unauthenticated mail.',
    status: { tone: 'neutral', label: 'Not set up' },
    record: { type: 'TXT', host: '_dmarc', value: 'v=DMARC1; p=none; rua=mailto:dmarc@businesslab.com' },
  },
]

function CheckCard({ c }) {
  const [open, setOpen] = useState(c.name === 'DKIM')
  return (
    <div className="rounded-md border border-line bg-white">
      <div className="flex items-center justify-between gap-3 p-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-ink">{c.name}</span>
            <Tag tone={c.status.tone} dot>{c.status.label}</Tag>
          </div>
          <p className="mt-0.5 text-tiny text-muted">{c.desc}</p>
        </div>
        <button onClick={() => setOpen((o) => !o)} className="flex items-center gap-1 text-tiny text-accent hover:underline">
          View instructions
          <ChevronDown size={14} className={cx('transition-transform', open && 'rotate-180')} />
        </button>
      </div>
      {open && (
        <div className="border-t border-line bg-panel p-4">
          <div className="grid grid-cols-[60px_120px_1fr_auto] items-center gap-3 rounded border border-line bg-white px-3 py-2 text-tiny">
            <span className="text-faint">Type</span>
            <span className="text-faint">Host</span>
            <span className="text-faint">Value</span>
            <span />
            <span className="font-medium text-ink">{c.record.type}</span>
            <span className="font-mono text-ink">{c.record.host}</span>
            <span className="truncate font-mono text-ink">{c.record.value}</span>
            <button className="flex items-center gap-1 rounded border border-line-mid px-1.5 py-0.5 text-tiny text-muted hover:bg-hover">
              <Copy size={12} /> Copy
            </button>
          </div>
          <p className="mt-2 text-tiny text-muted">Add this record at your DNS provider, then re-check.</p>
        </div>
      )}
    </div>
  )
}

export default function Domain() {
  const navigate = useNavigate()
  return (
    <OnboardingShell step={4}>
      <Card>
        <h1 className="text-title font-semibold text-ink">Check your email domain readiness.</h1>
        <p className="mt-1.5 text-sm text-muted">
          These three records help your emails reach the inbox instead of spam. You can finish them now or later.
        </p>

        <div className="mt-5 rounded-md border border-line bg-panel p-4">
          <div className="flex items-center justify-between text-sm">
            <span className="font-medium text-ink">Domain readiness</span>
            <span className="font-semibold text-warning-text">60%</span>
          </div>
          <Progress value={60} tone="warning" className="mt-2" />
        </div>

        <div className="mt-4 space-y-3">
          {CHECKS.map((c) => (
            <CheckCard key={c.name} c={c} />
          ))}
        </div>

        <div className="mt-7 flex items-center justify-between">
          <button onClick={() => navigate('/onboarding/done')} className="text-sm text-muted hover:text-ink">
            Skip for now
          </button>
          <Button variant="primary" onClick={() => navigate('/onboarding/done')}>Continue</Button>
        </div>
      </Card>
    </OnboardingShell>
  )
}
