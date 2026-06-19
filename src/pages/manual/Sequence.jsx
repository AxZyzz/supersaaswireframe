import { useNavigate } from 'react-router-dom'
import {
  Mail,
  Clock,
  Pencil,
  Copy,
  Trash2,
  Plus,
  ChevronDown,
} from 'lucide-react'
import { ManualLayout } from '../../components/ManualStepper.jsx'
import { Tag, cx } from '../../components/ui.jsx'

const STEPS = [
  { n: 1, kind: 'email', title: 'Initial email', subject: 'Quick idea for {{company}}', preview: 'Hi {{first_name}}, I came across {{company}} in the directory…' },
  { delay: 'Wait 3 days', cond: 'if no reply' },
  { n: 2, kind: 'email', title: 'Follow-up 1', subject: 'Re: Quick idea for {{company}}', preview: 'Just floating this back to the top of your inbox…' },
  { delay: 'Wait 4 days', cond: 'if no reply' },
  { n: 3, kind: 'email', title: 'Follow-up 2', subject: 'Last note about {{company}}', preview: 'I’ll leave it here — but the offer stands…' },
]

function EmailCard({ step, navigate }) {
  return (
    <div className="rounded-lg border border-line bg-white">
      <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
        <div className="flex items-center gap-2.5">
          <span className="flex h-7 w-7 items-center justify-center rounded-md bg-accent-soft text-accent">
            <Mail size={15} strokeWidth={1.9} />
          </span>
          <span className="text-sm font-medium text-ink">Step {step.n} — {step.title}</span>
        </div>
        <div className="flex items-center gap-1">
          <button onClick={() => navigate('/campaigns/new/template')} className="rounded p-1.5 text-muted hover:bg-hover hover:text-ink"><Pencil size={14} /></button>
          <button className="rounded p-1.5 text-muted hover:bg-hover hover:text-ink"><Copy size={14} /></button>
          <button className="rounded p-1.5 text-muted hover:bg-hover hover:text-danger-text"><Trash2 size={14} /></button>
        </div>
      </div>
      <div className="px-4 py-3">
        <div className="text-sm font-medium text-ink">{step.subject}</div>
        <div className="mt-1 text-tiny text-muted">{step.preview}</div>
        <div className="mt-3 flex items-center gap-2">
          <span className="text-tiny text-muted">Send if:</span>
          <select defaultValue={step.n === 1 ? 'Always' : 'No reply'} className="h-7 rounded border border-line-mid bg-white px-2 text-tiny text-ink focus-ring">
            <option>Always</option>
            <option>No reply</option>
            <option>Not opened</option>
            <option>Tag exists</option>
            <option>Tag does not exist</option>
          </select>
          <span className="text-faint">·</span>
          <span className="flex items-center gap-1 rounded border border-line-mid bg-page px-2 py-1 text-tiny text-muted">Stop if conversion signal received</span>
        </div>
      </div>
    </div>
  )
}

function DelayNode({ step }) {
  return (
    <div className="flex items-center gap-2 py-1 pl-4">
      <span className="flex h-6 w-6 items-center justify-center rounded-full bg-warning-bg text-warning-text">
        <Clock size={13} />
      </span>
      <div className="flex items-center gap-2 rounded-md border border-line bg-page px-2.5 py-1.5">
        <span className="text-tiny text-ink">{step.delay}</span>
        <Tag tone="neutral">{step.cond}</Tag>
      </div>
    </div>
  )
}

export default function Sequence() {
  const navigate = useNavigate()
  return (
    <ManualLayout step={4} back="/campaigns/new/template" next="/campaigns/new/preview">
      <div className="mx-auto max-w-3xl p-6">
        <h1 className="text-section font-semibold text-ink">Follow-up sequence</h1>
        <p className="mt-1 text-sm text-muted">Add steps and delays. Each step only sends if its condition is met.</p>

        <div className="mt-6 grid gap-5 lg:grid-cols-[1fr_220px]">
          {/* Builder column with connector line */}
          <div className="relative">
            <div className="absolute bottom-4 left-[14px] top-4 w-px bg-line-mid" />
            <div className="relative space-y-1">
              {STEPS.map((s, i) =>
                s.kind === 'email' ? (
                  <div key={i} className="pl-0">
                    <EmailCard step={s} navigate={navigate} />
                  </div>
                ) : (
                  <DelayNode key={i} step={s} />
                ),
              )}
              <button className="ml-0 mt-2 flex w-full items-center justify-center gap-1.5 rounded-md border border-dashed border-line-mid bg-white py-2.5 text-sm text-accent hover:bg-hover">
                <Plus size={15} /> Add step
              </button>
            </div>
          </div>

          {/* Summary rail */}
          <div className="h-fit rounded-lg border border-line bg-white p-4">
            <div className="text-sm font-semibold text-ink">Summary</div>
            <ul className="mt-3 space-y-2.5 text-sm">
              <li className="flex items-center justify-between"><span className="text-muted">Emails</span><span className="font-medium text-ink">3</span></li>
              <li className="flex items-center justify-between"><span className="text-muted">Duration</span><span className="font-medium text-ink">~10 days</span></li>
              <li className="flex items-center justify-between"><span className="text-muted">Stop on reply</span><span><Tag tone="success">On</Tag></span></li>
            </ul>
            <p className="mt-3 border-t border-line pt-3 text-tiny text-muted">
              3 emails over ~10 days. Sending pauses for any lead who replies.
            </p>
            <button onClick={() => navigate('/settings?tab=signals')} className="mt-2 flex items-center gap-1 text-tiny text-accent hover:underline">
              <Plus size={12} /> Add signal rule
            </button>
          </div>
        </div>
      </div>
    </ManualLayout>
  )
}
