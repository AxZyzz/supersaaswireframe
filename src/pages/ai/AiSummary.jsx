import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Pencil,
  RefreshCw,
  ChevronDown,
  Clock,
  Mail,
  Users,
  Send as SendIcon,
  Sparkles,
} from 'lucide-react'
import { Tag, Button, cx } from '../../components/ui.jsx'

const EMAILS = [
  {
    n: 1,
    subject: 'Quick idea for {{company}}',
    body: "Hi {{first_name}},\n\nI came across {{company}} in the directory and had a quick idea on bringing in more local clients. We help service businesses like yours turn directory visibility into booked appointments.\n\nWould you be open to a 15-minute call this week? Happy to share what's working for similar clinics and firms.\n\nBest,\nYakin",
  },
  {
    n: 2,
    subject: 'Following up, {{first_name}}',
    delay: 'Wait 3 days (if no reply)',
    body: "Hi {{first_name}},\n\nJust floating my note back to the top of your inbox. If growing new enquiries for {{company}} is on your radar this quarter, a short call could be worth it.\n\nWould Thursday or Friday suit?\n\nBest,\nYakin",
  },
  {
    n: 3,
    subject: 'Last note about {{company}}',
    delay: 'Wait 4 days (if no reply)',
    body: "Hi {{first_name}},\n\nI'll leave it here so I'm not crowding your inbox. If the timing's ever right for {{company}} to bring in more local clients, just reply and we'll set something up.\n\nWishing you a great quarter,\nYakin",
  },
]

function EmailCard({ e }) {
  const [open, setOpen] = useState(e.n === 1)
  return (
    <div className="rounded-md border border-line bg-white">
      <button onClick={() => setOpen((o) => !o)} className="flex w-full items-center justify-between px-4 py-3 text-left">
        <div className="flex items-center gap-2.5">
          <span className="flex h-7 w-7 items-center justify-center rounded-md bg-accent-soft text-accent">
            <Mail size={14} strokeWidth={1.9} />
          </span>
          <div>
            <div className="text-sm font-medium text-ink">Email {e.n} — {e.subject}</div>
            {e.delay && <div className="text-tiny text-muted">{e.delay}</div>}
          </div>
        </div>
        <ChevronDown size={16} className={cx('text-faint transition-transform', open && 'rotate-180')} />
      </button>
      {open && (
        <div className="border-t border-line px-4 py-3">
          <pre className="whitespace-pre-wrap font-sans text-sm leading-relaxed text-ink">{e.body}</pre>
          <div className="mt-3 flex gap-2">
            <Button variant="secondary" size="sm" icon={RefreshCw}>Regenerate</Button>
            <Button variant="ghost" size="sm" icon={Pencil}>Edit</Button>
          </div>
        </div>
      )}
    </div>
  )
}

function Row({ icon: Icon, label, value }) {
  return (
    <div className="flex items-center justify-between px-4 py-2.5">
      <span className="flex items-center gap-2 text-sm text-muted">
        <Icon size={15} className="text-faint" /> {label}
      </span>
      <span className="flex items-center gap-2 text-sm font-medium text-ink">
        {value}
        <button className="rounded p-0.5 text-faint hover:bg-hover hover:text-ink"><Pencil size={13} /></button>
      </span>
    </div>
  )
}

export default function AiSummary() {
  const navigate = useNavigate()
  return (
    <div className="mx-auto max-w-3xl p-6">
      <div className="flex items-center gap-2">
        <Sparkles size={18} className="text-accent" />
        <h1 className="text-title font-semibold text-ink">Here's your campaign draft.</h1>
      </div>
      <p className="mt-1 text-sm text-muted">Review and edit before launching. Everything is fully editable.</p>

      <div className="mt-6 space-y-4">
        {/* Meta card */}
        <div className="divide-y divide-line rounded-lg border border-line bg-white">
          <Row icon={SendIcon} label="Campaign name" value="Hot Leads — Book a Call" />
          <Row icon={Users} label="Audience" value="Hot Leads segment · 320 leads" />
          <Row icon={Mail} label="Senders" value="outreach@businesslab.com (rotation on)" />
          <Row icon={Clock} label="Sequence" value="3 emails over ~10 days" />
        </div>

        {/* Generated emails */}
        <div>
          <div className="mb-2 flex items-center gap-2 text-sm font-medium text-ink">
            <Sparkles size={14} className="text-accent" /> Generated sequence
          </div>
          <div className="space-y-2.5">
            {EMAILS.map((e) => (
              <EmailCard key={e.n} e={e} />
            ))}
          </div>
        </div>
      </div>

      {/* Actions */}
      <div className="mt-6 flex items-center justify-between border-t border-line pt-5">
        <Button variant="secondary" onClick={() => navigate('/campaigns/new/setup')}>Edit in builder</Button>
        <Button variant="primary" icon={SendIcon} onClick={() => navigate('/campaigns/launched')}>
          Launch campaign
        </Button>
      </div>
    </div>
  )
}
