import { Link, useNavigate } from 'react-router-dom'
import {
  Users,
  Sparkles,
  Inbox,
  BarChart3,
  ArrowRight,
  Send,
  Reply,
  Check,
} from 'lucide-react'
import { PublicNav, PublicFooter } from '../components/Public.jsx'
import { Button, Tag, Avatar } from '../components/ui.jsx'

// Small faux dashboard image used in the hero + feature blocks
function FauxDashboard() {
  return (
    <div className="overflow-hidden rounded-lg border border-line bg-white shadow-float">
      <div className="flex items-center gap-1.5 border-b border-line bg-panel px-3 py-2">
        <span className="h-2.5 w-2.5 rounded-full bg-line-faint" />
        <span className="h-2.5 w-2.5 rounded-full bg-line-faint" />
        <span className="h-2.5 w-2.5 rounded-full bg-line-faint" />
        <span className="ml-2 text-micro text-faint">app.businesslab.com/dashboard</span>
      </div>
      <div className="flex">
        <div className="w-28 shrink-0 space-y-1.5 border-r border-line bg-sidebar p-2">
          <div className="h-5 rounded bg-accent-soft" />
          {['', '', '', ''].map((_, i) => (
            <div key={i} className="h-4 rounded bg-hover" />
          ))}
        </div>
        <div className="flex-1 space-y-2.5 p-3">
          <div className="grid grid-cols-3 gap-2">
            {[
              { l: 'Leads', v: '12,480' },
              { l: 'Sent', v: '38,210' },
              { l: 'Reply', v: '7.4%' },
            ].map((s) => (
              <div key={s.l} className="rounded border border-line p-2">
                <div className="text-[9px] text-muted">{s.l}</div>
                <div className="text-sm font-semibold text-ink">{s.v}</div>
              </div>
            ))}
          </div>
          <div className="rounded border border-line p-2">
            <div className="mb-1.5 flex items-end gap-1.5">
              {[40, 64, 52, 78, 60, 88, 70].map((h, i) => (
                <div key={i} className="flex-1 rounded-sm bg-accent-soft2" style={{ height: h }} />
              ))}
            </div>
          </div>
          <div className="space-y-1.5">
            {['Anita Sharma', 'Marcus Lee', 'Priya Nair'].map((n, i) => (
              <div key={n} className="flex items-center gap-2 rounded border border-line px-2 py-1.5">
                <Avatar name={n} size={20} />
                <span className="text-[11px] text-ink">{n}</span>
                <span className="ml-auto">
                  <Tag tone={['success', 'purple', 'info'][i]} dot>
                    {['Interested', 'Replied', 'Contacted'][i]}
                  </Tag>
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

const FEATURES = [
  { icon: Users, h: 'Lead management', a: 'Import from CSV, Google Sheets, your API, or Brilliant Directories.', b: 'Tag, segment, and track every lead in one dense, fast table.' },
  { icon: Sparkles, h: 'AI campaign builder', a: 'Answer a few questions and let the assistant draft your emails and follow-ups.', b: 'Edit anything before launch — you stay in control.' },
  { icon: Inbox, h: 'Unified inbox', a: 'Every reply lands in one place, auto-classified by intent.', b: 'Interested, question, out of office — triage in seconds.' },
  { icon: BarChart3, h: 'Analytics', a: 'Opens, replies, and conversions across campaigns and sources.', b: 'See which segment and which step actually performs.' },
]

const STEPS = [
  { n: 1, h: 'Import leads', t: 'Bring in your directory members from a spreadsheet or API.' },
  { n: 2, h: 'Build a campaign', t: 'Use the AI assistant or set up sequences manually.' },
  { n: 3, h: 'Manage replies', t: 'Handle every response from a single, calm inbox.' },
]

export default function Landing() {
  const navigate = useNavigate()
  return (
    <div className="min-h-screen bg-white">
      <PublicNav />

      {/* Hero */}
      <section className="mx-auto grid max-w-6xl items-center gap-12 px-6 py-16 md:grid-cols-2 md:py-24">
        <div>
          <Tag tone="info" className="mb-5">For directory owners & communities</Tag>
          <h1 className="text-[42px] font-semibold leading-[1.1] tracking-tight text-ink md:text-[52px]">
            Turn your directory into a pipeline.
          </h1>
          <p className="mt-5 max-w-md text-base leading-relaxed text-muted">
            Import leads, launch AI-assisted email campaigns, and manage every reply in one inbox.
          </p>
          <div className="mt-7 flex items-center gap-3">
            <Button variant="primary" size="md" onClick={() => navigate('/signup')} className="h-10 px-5">
              Start free <ArrowRight size={16} className="ml-1" />
            </Button>
            <Button variant="secondary" size="md" onClick={() => navigate('/pricing')} className="h-10 px-5">
              See pricing
            </Button>
          </div>
          <p className="mt-4 text-tiny text-muted">No credit card required · Set up in minutes</p>
        </div>
        <FauxDashboard />
      </section>

      {/* Logos row */}
      <section className="border-y border-line bg-page">
        <div className="mx-auto max-w-6xl px-6 py-8">
          <p className="text-center text-tiny uppercase tracking-wide text-faint">Trusted by directory owners</p>
          <div className="mt-5 flex flex-wrap items-center justify-center gap-x-12 gap-y-4 opacity-70">
            {['NorthStar', 'CityBiz Hub', 'GreenList', 'MediConnect', 'LocalEdge'].map((l) => (
              <span key={l} className="text-section font-semibold text-line-faint">{l}</span>
            ))}
          </div>
        </div>
      </section>

      {/* Feature sections (alternating) */}
      <section className="mx-auto max-w-6xl px-6 py-20">
        <div className="space-y-20">
          {FEATURES.map((f, i) => (
            <div key={f.h} className={`grid items-center gap-10 md:grid-cols-2 ${i % 2 ? 'md:[&>*:first-child]:order-2' : ''}`}>
              <div>
                <span className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-accent-soft text-accent">
                  <f.icon size={19} strokeWidth={1.9} />
                </span>
                <h2 className="mt-4 text-title font-semibold text-ink">{f.h}</h2>
                <p className="mt-2 max-w-sm text-sm leading-relaxed text-muted">{f.a}</p>
                <p className="mt-1.5 max-w-sm text-sm leading-relaxed text-muted">{f.b}</p>
              </div>
              <FauxDashboard />
            </div>
          ))}
        </div>
      </section>

      {/* How it works */}
      <section className="border-t border-line bg-page">
        <div className="mx-auto max-w-6xl px-6 py-20">
          <h2 className="text-center text-title font-semibold text-ink">How it works</h2>
          <p className="mt-2 text-center text-sm text-muted">Three steps from directory to pipeline.</p>
          <div className="mt-10 grid gap-5 md:grid-cols-3">
            {STEPS.map((s) => (
              <div key={s.n} className="rounded-lg border border-line bg-white p-6">
                <span className="flex h-8 w-8 items-center justify-center rounded-full bg-accent text-sm font-semibold text-white">
                  {s.n}
                </span>
                <h3 className="mt-4 text-section font-semibold text-ink">{s.h}</h3>
                <p className="mt-1.5 text-sm leading-relaxed text-muted">{s.t}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA band */}
      <section className="bg-accent">
        <div className="mx-auto flex max-w-6xl flex-col items-center gap-5 px-6 py-16 text-center">
          <h2 className="text-title font-semibold text-white">Ready to start?</h2>
          <p className="max-w-md text-sm text-white/80">
            Build your first AI-assisted campaign today. It only takes a few minutes.
          </p>
          <Link
            to="/signup"
            className="inline-flex h-10 items-center gap-1.5 rounded bg-white px-5 text-sm font-medium text-accent hover:bg-white/90"
          >
            Start free <ArrowRight size={16} />
          </Link>
        </div>
      </section>

      <PublicFooter />
    </div>
  )
}
