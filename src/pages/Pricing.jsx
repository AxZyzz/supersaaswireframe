import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Check, Plus, Minus } from 'lucide-react'
import { PublicNav, PublicFooter } from '../components/Public.jsx'
import { Button, Tag, Segmented, cx } from '../components/ui.jsx'
import { planLimits } from '../data/mock2.js'

const limitsByName = Object.fromEntries(planLimits.map((p) => [p.name, p.limits]))
const LIMIT_ROWS = [
  ['Leads included', 'leads'],
  ['Monthly emails', 'emails'],
  ['Active campaigns', 'campaigns'],
  ['Sender accounts', 'senders'],
  ['AI generations', 'ai'],
]

const PLANS = [
  {
    name: 'Starter',
    tag: 'For getting started',
    price: { mo: '$0', yr: '$0' },
    note: 'Free forever',
    features: ['1,000 leads', '1 sender', 'Manual campaigns', 'Unified inbox', 'CSV & Google Sheet import'],
    cta: 'Start free',
  },
  {
    name: 'Growth',
    tag: 'For active outreach',
    price: { mo: '$49', yr: '$39' },
    note: 'per month',
    highlight: true,
    features: ['Everything in Starter', 'AI campaign builder', '5 senders', 'Sender rotation & ramp-up', 'Analytics', '25,000 leads'],
    cta: 'Start free',
  },
  {
    name: 'Scale',
    tag: 'For directories & agencies',
    price: { mo: '$149', yr: '$119' },
    note: 'per month',
    features: ['Everything in Growth', 'White-label readiness', 'API access', 'Admin tools', 'Priority support', 'Unlimited leads'],
    cta: 'Contact sales',
  },
]

const FAQ = [
  { q: 'Is this a real product or a prototype?', a: 'This is a clickable UI prototype for stakeholder review. Nothing here sends email, saves data, or charges a card.' },
  { q: 'Where do my leads come from?', a: 'Import from CSV, Google Sheets, a REST API, or Brilliant Directories. You can tag and segment on import.' },
  { q: 'Can the AI write my campaigns?', a: 'Yes — the AI assistant drafts your emails and follow-up sequence from a few short answers. You can edit everything before launch.' },
  { q: 'How does sender rotation work?', a: 'Spread sending across multiple connected addresses with daily limits and a gradual ramp-up to protect deliverability.' },
  { q: 'Can I switch plans later?', a: 'Yes, you can upgrade or downgrade at any time. Limits adjust immediately.' },
]

function FaqItem({ item }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="border-b border-line">
      <button onClick={() => setOpen((o) => !o)} className="flex w-full items-center justify-between gap-4 py-4 text-left">
        <span className="text-sm font-medium text-ink">{item.q}</span>
        {open ? <Minus size={16} className="text-faint" /> : <Plus size={16} className="text-faint" />}
      </button>
      {open && <p className="pb-4 text-sm leading-relaxed text-muted">{item.a}</p>}
    </div>
  )
}

export default function Pricing() {
  const navigate = useNavigate()
  const [cycle, setCycle] = useState('mo')
  return (
    <div className="min-h-screen bg-white">
      <PublicNav />
      <section className="mx-auto max-w-5xl px-6 py-16">
        <h1 className="text-center text-title font-semibold text-ink md:text-[32px]">Simple pricing for every stage.</h1>
        <p className="mt-2 text-center text-sm text-muted">Start free. Upgrade when your outreach grows.</p>

        <div className="mt-7 flex justify-center">
          <Segmented
            options={[
              { value: 'mo', label: 'Monthly' },
              { value: 'yr', label: 'Yearly · save 20%' },
            ]}
            value={cycle}
            onChange={setCycle}
          />
        </div>

        <div className="mt-10 grid gap-5 md:grid-cols-3">
          {PLANS.map((p) => (
            <div
              key={p.name}
              className={cx(
                'relative flex flex-col rounded-lg border bg-white p-6',
                p.highlight ? 'border-accent shadow-float' : 'border-line',
              )}
            >
              {p.highlight && (
                <span className="absolute -top-2.5 left-6">
                  <Tag tone="info">Most popular</Tag>
                </span>
              )}
              <div className="text-sm font-semibold text-ink">{p.name}</div>
              <div className="mt-0.5 text-tiny text-muted">{p.tag}</div>
              <div className="mt-4 flex items-end gap-1.5">
                <span className="text-[32px] font-semibold leading-none text-ink">{p.price[cycle]}</span>
                <span className="pb-1 text-tiny text-muted">{p.note}</span>
              </div>
              <Button
                variant={p.highlight ? 'primary' : 'secondary'}
                onClick={() => navigate('/signup')}
                className="mt-5 w-full"
              >
                {p.cta}
              </Button>

              {/* Usage limits */}
              <dl className="mt-5 space-y-1.5 border-t border-line pt-4">
                {LIMIT_ROWS.map(([label, key]) => (
                  <div key={key} className="flex items-center justify-between text-tiny">
                    <dt className="text-muted">{label}</dt>
                    <dd className="font-medium text-ink">{limitsByName[p.name]?.[key]}</dd>
                  </div>
                ))}
              </dl>

              <ul className="mt-5 space-y-2.5 border-t border-line pt-4">
                {p.features.map((f) => (
                  <li key={f} className="flex items-start gap-2 text-sm text-ink">
                    <Check size={15} className="mt-0.5 shrink-0 text-accent" strokeWidth={2.2} />
                    {f}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="mx-auto mt-16 max-w-2xl">
          <h2 className="text-center text-section font-semibold text-ink">Frequently asked questions</h2>
          <div className="mt-5">
            {FAQ.map((f) => (
              <FaqItem key={f.q} item={f} />
            ))}
          </div>
        </div>
      </section>
      <PublicFooter />
    </div>
  )
}
