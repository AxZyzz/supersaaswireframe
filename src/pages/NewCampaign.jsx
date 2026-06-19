import { useNavigate } from 'react-router-dom'
import { Sparkles, SlidersHorizontal, ArrowRight, Check, Gauge } from 'lucide-react'
import { Tag, Banner, Button, cx } from '../components/ui.jsx'
import FutureChannels from '../components/FutureChannels.jsx'
import { usage } from '../data/mock2.js'

export default function NewCampaign() {
  const navigate = useNavigate()
  return (
    <div className="mx-auto max-w-3xl px-6 py-12">
      <div className="text-center">
        <h1 className="text-title font-semibold text-ink">Create a campaign.</h1>
        <p className="mt-1.5 text-sm text-muted">Choose how you want to build it.</p>
      </div>

      <div className="mt-5">
        <Banner tone="warning" icon={Gauge} action={<Button size="sm" variant="secondary" onClick={() => navigate('/settings?tab=billing')}>View usage</Button>}>
          You are using {usage.campaigns.used} of {usage.campaigns.max} active campaigns on the Growth plan.
        </Banner>
      </div>

      <div className="mt-8 grid gap-5 md:grid-cols-2">
        {/* AI (recommended) */}
        <button
          onClick={() => navigate('/campaigns/new/ai')}
          className="group relative flex flex-col rounded-lg border border-accent bg-white p-6 text-left shadow-float transition-transform hover:-translate-y-0.5"
        >
          <span className="absolute right-4 top-4"><Tag tone="info">Recommended</Tag></span>
          <span className="flex h-11 w-11 items-center justify-center rounded-lg bg-accent text-white">
            <Sparkles size={22} strokeWidth={1.9} />
          </span>
          <h2 className="mt-4 text-section font-semibold text-ink">Build with AI</h2>
          <p className="mt-1.5 text-sm leading-relaxed text-muted">
            Answer a few questions and let the assistant draft your campaign, emails, and follow-ups.
          </p>
          <ul className="mt-4 space-y-1.5 text-tiny text-muted">
            {['Drafts your sequence in seconds', 'Tailored to your segment & goal', 'Fully editable before launch'].map((f) => (
              <li key={f} className="flex items-center gap-1.5">
                <Check size={13} className="text-accent" /> {f}
              </li>
            ))}
          </ul>
          <span className="mt-5 inline-flex items-center gap-1.5 text-sm font-medium text-accent">
            Start with AI <ArrowRight size={15} className="transition-transform group-hover:translate-x-0.5" />
          </span>
        </button>

        {/* Manual */}
        <button
          onClick={() => navigate('/campaigns/new/setup')}
          className="group flex flex-col rounded-lg border border-line bg-white p-6 text-left transition-transform hover:-translate-y-0.5 hover:border-line-mid"
        >
          <span className="flex h-11 w-11 items-center justify-center rounded-lg bg-panel text-muted">
            <SlidersHorizontal size={22} strokeWidth={1.9} />
          </span>
          <h2 className="mt-4 text-section font-semibold text-ink">Build manually</h2>
          <p className="mt-1.5 text-sm leading-relaxed text-muted">
            Set up your segment, sender, templates, and follow-up steps yourself.
          </p>
          <ul className="mt-4 space-y-1.5 text-tiny text-muted">
            {['Full control over every step', 'Reuse saved templates', 'Custom delays & conditions'].map((f) => (
              <li key={f} className="flex items-center gap-1.5">
                <Check size={13} className="text-muted" /> {f}
              </li>
            ))}
          </ul>
          <span className="mt-5 inline-flex items-center gap-1.5 text-sm font-medium text-ink">
            Build manually <ArrowRight size={15} className="transition-transform group-hover:translate-x-0.5" />
          </span>
        </button>
      </div>

      <p className="mt-6 text-center text-tiny text-faint">You can switch between modes anytime.</p>

      <div className="mt-8">
        <FutureChannels title="Future channels" />
      </div>
    </div>
  )
}
