import { useNavigate } from 'react-router-dom'
import { Check, AlertTriangle, ChevronRight } from 'lucide-react'
import { ManualLayout } from '../../components/ManualStepper.jsx'
import { Tag, Button, cx } from '../../components/ui.jsx'

function ReviewSection({ title, editTo, navigate, children }) {
  return (
    <div className="rounded-lg border border-line bg-white">
      <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
        <span className="text-sm font-semibold text-ink">{title}</span>
        <button onClick={() => navigate(editTo)} className="text-tiny text-accent hover:underline">Edit</button>
      </div>
      <div className="px-4 py-3 text-sm text-ink">{children}</div>
    </div>
  )
}

const CHECKS = [
  { ok: true, label: 'Senders verified', tone: 'success' },
  { ok: false, label: 'Domain readiness 60% — DKIM action needed', tone: 'warning' },
  { ok: true, label: 'Segment has 320 leads', tone: 'success' },
  { ok: true, label: 'Unsubscribe link included', tone: 'success' },
]

export default function Preview() {
  const navigate = useNavigate()
  return (
    <ManualLayout
      step={5}
      back="/campaigns/new/sequence"
      nextLabel="Launch campaign"
      onNext={() => navigate('/campaigns/launched')}
    >
      <div className="mx-auto max-w-3xl p-6">
        <h1 className="text-section font-semibold text-ink">Review & launch</h1>
        <p className="mt-1 text-sm text-muted">Check everything looks right before sending.</p>

        <div className="mt-6 grid gap-4 lg:grid-cols-[1fr_260px]">
          <div className="space-y-3">
            <ReviewSection title="Campaign" editTo="/campaigns/new/setup" navigate={navigate}>
              <div className="flex items-center justify-between">
                <span>Q3 Directory Outreach</span>
                <span className="text-muted">Send now · cap 200/day</span>
              </div>
            </ReviewSection>

            <ReviewSection title="Audience" editTo="/campaigns/new/setup" navigate={navigate}>
              320 leads — <span className="text-muted">Hot Leads segment</span>
            </ReviewSection>

            <ReviewSection title="Senders" editTo="/campaigns/new/senders" navigate={navigate}>
              2 senders, rotation on, 50/day each, ramp-up on
            </ReviewSection>

            <ReviewSection title="Sequence" editTo="/campaigns/new/sequence" navigate={navigate}>
              <div className="text-muted">3 emails over 10 days</div>
              <ul className="mt-2 space-y-1.5">
                {[
                  'Email 1 — Quick idea for {{company}}',
                  'Wait 3 days · Email 2 — Re: Quick idea',
                  'Wait 4 days · Email 3 — Last note about {{company}}',
                ].map((e) => (
                  <li key={e} className="flex items-center gap-2 text-sm text-ink">
                    <ChevronRight size={13} className="text-faint" /> {e}
                  </li>
                ))}
              </ul>
            </ReviewSection>

            <div className="rounded-lg border border-line bg-page px-4 py-3 text-sm">
              <span className="text-muted">Estimated completion: </span>
              <span className="font-medium text-ink">July 1, 2026</span>
              <span className="text-muted"> · ~10 days at current ramp</span>
            </div>
          </div>

          {/* Pre-flight checklist */}
          <div className="h-fit rounded-lg border border-line bg-white p-4">
            <div className="text-sm font-semibold text-ink">Pre-flight checklist</div>
            <ul className="mt-3 space-y-2.5">
              {CHECKS.map((c) => (
                <li key={c.label} className="flex items-start gap-2 text-sm">
                  {c.ok ? (
                    <Check size={15} className="mt-0.5 shrink-0 text-success-text" strokeWidth={2.2} />
                  ) : (
                    <AlertTriangle size={15} className="mt-0.5 shrink-0 text-warning-text" />
                  )}
                  <span className={cx(c.ok ? 'text-ink' : 'text-warning-text')}>{c.label}</span>
                </li>
              ))}
            </ul>
            <div className="mt-4 space-y-2 border-t border-line pt-4">
              <Button variant="primary" className="w-full" onClick={() => navigate('/campaigns/launched')}>
                Launch campaign
              </Button>
              <Button variant="secondary" className="w-full" onClick={() => navigate('/campaigns')}>
                Save as draft
              </Button>
            </div>
          </div>
        </div>
      </div>
    </ManualLayout>
  )
}
