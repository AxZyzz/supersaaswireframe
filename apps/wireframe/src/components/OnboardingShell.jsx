import { Link } from 'react-router-dom'
import { Send, Check } from 'lucide-react'
import { cx } from './ui.jsx'

const STEPS = [
  { n: 1, label: 'Workspace', path: '/onboarding/workspace' },
  { n: 2, label: 'AI Memory', path: '/onboarding/business-memory' },
  { n: 3, label: 'Sender', path: '/onboarding/sender' },
  { n: 4, label: 'Domain', path: '/onboarding/domain' },
  { n: 5, label: 'Done', path: '/onboarding/done' },
]

export default function OnboardingShell({ step, children }) {
  return (
    <div className="flex min-h-screen flex-col bg-page">
      {/* Slim top bar with logo + stepper */}
      <header className="border-b border-line bg-white">
        <div className="mx-auto flex h-14 max-w-3xl items-center justify-between px-6">
          <Link to="/" className="flex items-center gap-2">
            <span className="flex h-7 w-7 items-center justify-center rounded bg-accent text-white">
              <Send size={15} strokeWidth={2} />
            </span>
            <span className="text-sm font-semibold text-ink">Business Lab</span>
          </Link>
          <ol className="hidden items-center gap-1 sm:flex">
            {STEPS.map((s, i) => {
              const done = step > s.n
              const active = step === s.n
              return (
                <li key={s.n} className="flex items-center gap-1">
                  <span
                    className={cx(
                      'flex h-6 w-6 items-center justify-center rounded-full text-micro font-medium',
                      done ? 'bg-accent-soft text-accent' : active ? 'bg-accent text-white' : 'bg-neut-bg text-faint',
                    )}
                  >
                    {done ? <Check size={13} strokeWidth={2.5} /> : s.n}
                  </span>
                  <span className={cx('text-tiny', active ? 'font-medium text-ink' : 'text-muted')}>{s.label}</span>
                  {i < STEPS.length - 1 && <span className="mx-1 h-px w-5 bg-line-mid" />}
                </li>
              )
            })}
          </ol>
        </div>
      </header>

      <main className="flex flex-1 items-start justify-center px-6 py-10">
        <div className="w-full max-w-xl">{children}</div>
      </main>
    </div>
  )
}
