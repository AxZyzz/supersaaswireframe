import { useState } from 'react'
import { Users } from 'lucide-react'
import { ManualLayout } from '../../components/ManualStepper.jsx'
import { Field, Input, Select, Callout, cx } from '../../components/ui.jsx'
import { segments } from '../../data/mock.js'
import { campaignGoals } from '../../data/mock2.js'

export default function Setup() {
  const [seg, setSeg] = useState('Hot Leads')
  const [sched, setSched] = useState('now')
  const [goal, setGoal] = useState('Book a call')
  const active = segments.find((s) => s.name === seg) || segments[0]

  return (
    <ManualLayout step={1} next="/campaigns/new/senders">
      <div className="mx-auto max-w-2xl p-6">
        <h1 className="text-section font-semibold text-ink">Campaign setup</h1>
        <p className="mt-1 text-sm text-muted">Name your campaign and choose who it goes to.</p>

        <div className="mt-6 space-y-5">
          <Field label="Campaign name">
            <Input defaultValue="Q3 Directory Outreach" />
          </Field>

          <Field label="Campaign goal" hint="Conversion goal used to judge this campaign — not just opens.">
            <Select value={goal} onChange={(e) => setGoal(e.target.value)}>
              {campaignGoals.map((g) => <option key={g}>{g}</option>)}
            </Select>
          </Field>
          {goal === 'Custom API event' && (
            <Callout tone="info">
              Conversions counted when your system posts <span className="font-mono">paid_listing_upgraded</span> to{' '}
              <span className="font-mono">api.businesslab.com/v1/events</span>. Configure in Settings → Integrations.
            </Callout>
          )}

          <div>
            <div className="mb-1.5 text-sm font-medium text-ink">Target segment</div>
            <div className="space-y-2">
              {segments.map((s) => (
                <button
                  key={s.name}
                  onClick={() => setSeg(s.name)}
                  className={cx(
                    'flex w-full items-center justify-between rounded-md border px-3 py-2.5 text-left transition-colors',
                    seg === s.name ? 'border-accent bg-accent-soft' : 'border-line-mid bg-white hover:bg-hover',
                  )}
                >
                  <span className="flex items-center gap-2.5">
                    <span className={cx('flex h-4 w-4 items-center justify-center rounded-full border', seg === s.name ? 'border-accent' : 'border-line-faint')}>
                      {seg === s.name && <span className="h-2 w-2 rounded-full bg-accent" />}
                    </span>
                    <span className="text-sm font-medium text-ink">{s.name}</span>
                  </span>
                  <span className="text-tiny text-muted">{s.count} leads</span>
                </button>
              ))}
              <button className="w-full rounded-md border border-dashed border-line-mid px-3 py-2.5 text-left text-sm text-accent hover:bg-hover">
                + Create new segment
              </button>
            </div>
            <div className="mt-2 flex items-center gap-1.5 text-tiny text-accent">
              <Users size={13} /> Sending to ~{active.count} leads
            </div>
          </div>

          <div>
            <div className="mb-1.5 text-sm font-medium text-ink">Schedule</div>
            <div className="flex gap-2">
              {[
                { v: 'now', l: 'Send now' },
                { v: 'later', l: 'Schedule for later' },
              ].map((o) => (
                <button
                  key={o.v}
                  onClick={() => setSched(o.v)}
                  className={cx(
                    'flex-1 rounded-md border px-3 py-2 text-sm transition-colors',
                    sched === o.v ? 'border-accent bg-accent-soft font-medium text-accent' : 'border-line-mid bg-white text-muted hover:bg-hover',
                  )}
                >
                  {o.l}
                </button>
              ))}
            </div>
            {sched === 'later' && (
              <div className="mt-2 grid grid-cols-2 gap-2">
                <Input type="date" defaultValue="2026-06-24" />
                <Input type="time" defaultValue="09:00" />
              </div>
            )}
          </div>

          <Field label="Daily cap" hint="Maximum emails sent per day across this campaign.">
            <Input type="number" defaultValue={200} className="w-32" />
          </Field>
        </div>
      </div>
    </ManualLayout>
  )
}
