import { useNavigate } from 'react-router-dom'
import { Check } from 'lucide-react'
import { Button, cx } from './ui.jsx'

const STEPS = [
  { n: 1, label: 'Setup', path: '/campaigns/new/setup' },
  { n: 2, label: 'Sender', path: '/campaigns/new/senders' },
  { n: 3, label: 'Template', path: '/campaigns/new/template' },
  { n: 4, label: 'Sequence', path: '/campaigns/new/sequence' },
  { n: 5, label: 'Preview', path: '/campaigns/new/preview' },
]

export function ManualLayout({ step, children, back, next, nextLabel = 'Next', onNext }) {
  const navigate = useNavigate()
  return (
    <div className="flex h-full flex-col">
      {/* Step indicator */}
      <div className="border-b border-line bg-white px-6 py-3">
        <ol className="mx-auto flex max-w-3xl items-center justify-between">
          {STEPS.map((s, i) => {
            const done = step > s.n
            const active = step === s.n
            return (
              <li key={s.n} className="flex flex-1 items-center">
                <button
                  onClick={() => navigate(s.path)}
                  className="flex items-center gap-2"
                >
                  <span
                    className={cx(
                      'flex h-6 w-6 items-center justify-center rounded-full text-micro font-medium',
                      done ? 'bg-accent-soft text-accent' : active ? 'bg-accent text-white' : 'bg-neut-bg text-faint',
                    )}
                  >
                    {done ? <Check size={13} strokeWidth={2.5} /> : s.n}
                  </span>
                  <span className={cx('text-tiny', active ? 'font-medium text-ink' : 'text-muted')}>{s.label}</span>
                </button>
                {i < STEPS.length - 1 && <span className="mx-2 h-px flex-1 bg-line-mid" />}
              </li>
            )
          })}
        </ol>
      </div>

      {/* Body */}
      <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>

      {/* Sticky footer */}
      <div className="flex items-center justify-between border-t border-line bg-white px-6 py-3">
        <Button variant="ghost" onClick={() => navigate('/campaigns')}>Save draft</Button>
        <div className="flex items-center gap-2">
          {back && <Button variant="secondary" onClick={() => navigate(back)}>Back</Button>}
          <Button variant="primary" onClick={onNext ? onNext : () => navigate(next)}>{nextLabel}</Button>
        </div>
      </div>
    </div>
  )
}
