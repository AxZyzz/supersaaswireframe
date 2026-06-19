import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Mail, Server, Info, Check } from 'lucide-react'
import OnboardingShell from '../../components/OnboardingShell.jsx'
import ReplyRouting from '../../components/ReplyRouting.jsx'
import { Button, Field, Input, Card, Callout, Toast, useToast, cx } from '../../components/ui.jsx'

function OptionCard({ active, onClick, icon: Icon, title, sub }) {
  return (
    <button
      onClick={onClick}
      className={cx(
        'relative flex flex-1 items-start gap-3 rounded-md border p-4 text-left transition-colors',
        active ? 'border-accent bg-accent-soft' : 'border-line-mid bg-white hover:bg-hover',
      )}
    >
      <span className={cx('flex h-9 w-9 items-center justify-center rounded-md', active ? 'bg-white text-accent' : 'bg-panel text-muted')}>
        <Icon size={18} strokeWidth={1.9} />
      </span>
      <span>
        <span className="block text-sm font-medium text-ink">{title}</span>
        <span className="mt-0.5 block text-tiny text-muted">{sub}</span>
      </span>
      {active && (
        <span className="absolute right-3 top-3 text-accent">
          <Check size={16} strokeWidth={2.4} />
        </span>
      )}
    </button>
  )
}

export default function Sender() {
  const navigate = useNavigate()
  const [opt, setOpt] = useState('google')
  const [toast, showToast] = useToast()
  return (
    <OnboardingShell step={3}>
      <Card>
        <h1 className="text-title font-semibold text-ink">Connect a sender email.</h1>
        <p className="mt-1.5 text-sm text-muted">
          Add the email address campaigns will send from. You can add more later.
        </p>

        <div className="mt-6 flex flex-col gap-3 sm:flex-row">
          <OptionCard active={opt === 'google'} onClick={() => setOpt('google')} icon={Mail} title="Connect with Google" sub="Gmail / Google Workspace" />
          <OptionCard active={opt === 'smtp'} onClick={() => setOpt('smtp')} icon={Server} title="Microsoft / SMTP" sub="Outlook or custom SMTP" />
        </div>

        <div className="mt-5 space-y-4 rounded-md border border-line bg-panel p-4">
          <div className="grid grid-cols-2 gap-4">
            <Field label="From name">
              <Input defaultValue="Yakin Shah" />
            </Field>
            <Field label="From email">
              <Input defaultValue="outreach@businesslab.com" />
            </Field>
          </div>
          <Field label="Daily send limit" hint="We recommend starting low and ramping up.">
            <Input type="number" defaultValue={50} className="w-32" />
          </Field>
        </div>

        <div className="mt-4">
          <Callout tone="info" icon={Info}>
            <span className="font-medium">Sender rotation</span> spreads your sending across multiple addresses so no
            single inbox sends too much at once — this protects your deliverability. Add more senders anytime in Settings.
          </Callout>
        </div>

        <div className="mt-7 flex items-center justify-between">
          <button onClick={() => navigate('/onboarding/domain')} className="text-sm text-muted hover:text-ink">
            I'll do this later
          </button>
          <Button variant="primary" onClick={() => navigate('/onboarding/domain')}>Continue</Button>
        </div>
      </Card>

      <div className="mt-4">
        <ReplyRouting onToast={showToast} />
      </div>
      {toast && <Toast>{toast}</Toast>}
    </OnboardingShell>
  )
}
