import { useEffect, useState } from 'react'
import { X, Copy, Check } from 'lucide-react'

// ── tone → tag classes (semantic palette) ─────────────────────────────────
const TONES = {
  success: 'bg-success-bg text-success-text',
  danger: 'bg-danger-bg text-danger-text',
  warning: 'bg-warning-bg text-warning-text',
  info: 'bg-info-bg text-info-text',
  purple: 'bg-purple-bg text-purple-text',
  neutral: 'bg-neut-bg text-neut-text',
}
const DOT = {
  success: 'bg-success-text',
  danger: 'bg-danger-text',
  warning: 'bg-warning-text',
  info: 'bg-info-text',
  purple: 'bg-purple-text',
  neutral: 'bg-faint',
}

export function cx(...a) {
  return a.filter(Boolean).join(' ')
}

// ── Tag / chip ────────────────────────────────────────────────────────────
export function Tag({ tone = 'neutral', dot = false, children, className }) {
  return (
    <span
      className={cx(
        'inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-micro font-medium whitespace-nowrap',
        TONES[tone],
        className,
      )}
    >
      {dot && <span className={cx('h-1.5 w-1.5 rounded-full', DOT[tone])} />}
      {children}
    </span>
  )
}

// ── Button ────────────────────────────────────────────────────────────────
const BTN = {
  primary: 'bg-accent text-white hover:bg-accent-hover active:bg-accent-pressed border border-transparent',
  secondary: 'bg-white text-ink border border-line-mid hover:bg-hover',
  ghost: 'bg-transparent text-muted hover:bg-hover border border-transparent',
  danger: 'bg-white text-danger-text border border-danger-bg hover:bg-danger-bg',
}
export function Button({ variant = 'secondary', size = 'md', icon: Icon, children, className, ...rest }) {
  const sizes = size === 'sm' ? 'h-8 px-2.5 text-sm' : 'h-9 px-3.5 text-sm'
  const iconOnly = !children
  return (
    <button
      className={cx(
        'inline-flex items-center justify-center gap-1.5 rounded font-medium transition-colors focus-ring select-none',
        sizes,
        iconOnly && (size === 'sm' ? 'w-8 px-0' : 'w-9 px-0'),
        BTN[variant],
        className,
      )}
      {...rest}
    >
      {Icon && <Icon size={16} strokeWidth={1.9} />}
      {children}
    </button>
  )
}

// ── Avatar ────────────────────────────────────────────────────────────────
export function Avatar({ name = '?', size = 24, tint }) {
  const initials = name
    .split(' ')
    .map((n) => n[0])
    .slice(0, 2)
    .join('')
    .toUpperCase()
  const fs = size <= 24 ? 10 : size <= 32 ? 12 : size <= 40 ? 14 : 20
  return (
    <span
      className="inline-flex shrink-0 items-center justify-center rounded-full font-medium"
      style={{
        width: size,
        height: size,
        fontSize: fs,
        background: tint?.bg || '#EDF0FD',
        color: tint?.text || '#3E63DD',
      }}
    >
      {initials}
    </span>
  )
}

// ── Card / panel ──────────────────────────────────────────────────────────
export function Card({ title, actions, children, className, bodyClass, noPad }) {
  return (
    <section className={cx('rounded-lg border border-line bg-white', className)}>
      {(title || actions) && (
        <header className="flex items-center justify-between border-b border-line px-4 py-3">
          <h3 className="text-sm font-semibold text-ink">{title}</h3>
          {actions}
        </header>
      )}
      <div className={cx(!noPad && 'p-4', bodyClass)}>{children}</div>
    </section>
  )
}

// ── Stat card ─────────────────────────────────────────────────────────────
export function StatCard({ label, value, delta, deltaTone = 'success', sub }) {
  return (
    <div className="rounded-lg border border-line bg-white p-4">
      <div className="text-tiny text-muted">{label}</div>
      <div className="mt-1.5 text-[24px] font-semibold leading-none text-ink">{value}</div>
      {delta && (
        <div className={cx('mt-2 text-tiny font-medium', deltaTone === 'danger' ? 'text-danger-text' : 'text-success-text')}>
          {deltaTone === 'danger' ? '▼' : '▲'} {delta}
        </div>
      )}
      {sub && <div className="mt-2 text-tiny text-muted">{sub}</div>}
    </div>
  )
}

// ── Inputs ────────────────────────────────────────────────────────────────
export function Input({ className, ...rest }) {
  return (
    <input
      className={cx(
        'h-[34px] w-full rounded border border-line-mid bg-white px-2.5 text-sm text-ink placeholder:text-faint focus-ring',
        className,
      )}
      {...rest}
    />
  )
}
export function Textarea({ className, ...rest }) {
  return (
    <textarea
      className={cx(
        'w-full rounded border border-line-mid bg-white px-2.5 py-2 text-sm text-ink placeholder:text-faint focus-ring',
        className,
      )}
      {...rest}
    />
  )
}
export function Select({ className, children, ...rest }) {
  return (
    <select
      className={cx(
        'h-[34px] w-full rounded border border-line-mid bg-white px-2.5 text-sm text-ink focus-ring',
        className,
      )}
      {...rest}
    >
      {children}
    </select>
  )
}
export function Field({ label, hint, children }) {
  return (
    <label className="block">
      <div className="mb-1.5 text-sm font-medium text-ink">{label}</div>
      {children}
      {hint && <div className="mt-1 text-tiny text-muted">{hint}</div>}
    </label>
  )
}

// ── Modal ─────────────────────────────────────────────────────────────────
export function Modal({ title, onClose, children, footer, width = 'max-w-2xl' }) {
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose?.()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/30 p-6 pt-[6vh]">
      <div className={cx('w-full rounded-lg border border-line bg-white shadow-float', width)}>
        <header className="flex items-center justify-between border-b border-line px-4 py-3">
          <h2 className="text-section font-semibold text-ink">{title}</h2>
          <button onClick={onClose} className="rounded p-1 text-muted hover:bg-hover" aria-label="Close">
            <X size={18} strokeWidth={1.9} />
          </button>
        </header>
        <div className="p-4">{children}</div>
        {footer && <footer className="flex items-center justify-end gap-2 border-t border-line px-4 py-3">{footer}</footer>}
      </div>
    </div>
  )
}

// ── Toast (static example) ────────────────────────────────────────────────
export function Toast({ children, onClose }) {
  return (
    <div className="fixed bottom-4 left-4 z-[60] flex items-center gap-3 rounded-lg border border-line bg-white px-4 py-3 text-sm text-ink shadow-float">
      <span className="h-2 w-2 rounded-full bg-success-text" />
      {children}
      {onClose && (
        <button onClick={onClose} className="ml-2 text-muted hover:text-ink">
          <X size={14} />
        </button>
      )}
    </div>
  )
}

// ── Tabs (underline style) ────────────────────────────────────────────────
export function Tabs({ tabs, active, onChange }) {
  return (
    <div className="flex items-center gap-1 border-b border-line">
      {tabs.map((t) => {
        const val = typeof t === 'string' ? t : t.value
        const label = typeof t === 'string' ? t : t.label
        const badge = typeof t === 'object' ? t.badge : null
        const on = active === val
        return (
          <button
            key={val}
            onClick={() => onChange(val)}
            className={cx(
              '-mb-px flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm transition-colors',
              on ? 'border-accent font-medium text-ink' : 'border-transparent text-muted hover:text-ink',
            )}
          >
            {label}
            {badge != null && (
              <span className="rounded-full bg-neut-bg px-1.5 text-micro text-muted">{badge}</span>
            )}
          </button>
        )
      })}
    </div>
  )
}

// ── Segmented control ─────────────────────────────────────────────────────
export function Segmented({ options, value, onChange, size = 'md' }) {
  const h = size === 'sm' ? 'h-8' : 'h-9'
  return (
    <div className={cx('inline-flex items-center rounded border border-line-mid bg-white p-0.5', h)}>
      {options.map((o) => {
        const val = typeof o === 'string' ? o : o.value
        const label = typeof o === 'string' ? o : o.label
        const Icon = typeof o === 'object' ? o.icon : null
        const on = value === val
        return (
          <button
            key={val}
            onClick={() => onChange(val)}
            className={cx(
              'inline-flex h-full items-center gap-1.5 rounded px-2.5 text-sm transition-colors',
              on ? 'bg-accent-soft font-medium text-accent' : 'text-muted hover:text-ink',
            )}
          >
            {Icon && <Icon size={15} strokeWidth={1.9} />}
            {label}
          </button>
        )
      })}
    </div>
  )
}

// ── Filter chip (dropdown look, non-functional) ───────────────────────────
export function FilterChip({ label, value, icon: Icon }) {
  return (
    <button className="inline-flex h-8 items-center gap-1.5 rounded border border-line-mid bg-white px-2.5 text-sm text-muted hover:bg-hover">
      {Icon && <Icon size={14} strokeWidth={1.9} />}
      <span className="text-faint">{label}:</span>
      <span className="text-ink">{value}</span>
      <span className="text-faint">▾</span>
    </button>
  )
}

// ── Empty state ───────────────────────────────────────────────────────────
export function EmptyState({ icon: Icon, title, body, action }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-14 text-center">
      {Icon && (
        <div className="mb-3 rounded-full bg-panel p-3 text-faint">
          <Icon size={26} strokeWidth={1.5} />
        </div>
      )}
      <div className="text-sm font-semibold text-ink">{title}</div>
      {body && <div className="mt-1 max-w-xs text-sm text-muted">{body}</div>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  )
}

// ── Soft info callout ─────────────────────────────────────────────────────
export function Callout({ tone = 'info', icon: Icon, children }) {
  return (
    <div className={cx('flex gap-2.5 rounded-md p-3 text-sm', TONES[tone])}>
      {Icon && <Icon size={16} strokeWidth={1.9} className="mt-0.5 shrink-0" />}
      <div className="leading-relaxed">{children}</div>
    </div>
  )
}

// ── Progress bar ──────────────────────────────────────────────────────────
export function Progress({ value, tone = 'accent', className }) {
  const bg = tone === 'accent' ? 'bg-accent' : tone === 'success' ? 'bg-success-text' : 'bg-warning-text'
  return (
    <div className={cx('h-1.5 w-full overflow-hidden rounded-full bg-neut-bg', className)}>
      <div className={cx('h-full rounded-full', bg)} style={{ width: `${value}%` }} />
    </div>
  )
}

// ── Toggle switch (visual) ────────────────────────────────────────────────
export function Toggle({ checked, onChange, label, hint }) {
  return (
    <label className="flex cursor-pointer items-start justify-between gap-4">
      {(label || hint) && (
        <span className="min-w-0">
          {label && <span className="block text-sm font-medium text-ink">{label}</span>}
          {hint && <span className="mt-0.5 block text-tiny text-muted">{hint}</span>}
        </span>
      )}
      <button
        type="button"
        onClick={() => onChange?.(!checked)}
        className={cx(
          'relative mt-0.5 h-5 w-9 shrink-0 rounded-full transition-colors',
          checked ? 'bg-accent' : 'bg-line-faint',
        )}
      >
        <span
          className={cx(
            'absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all',
            checked ? 'left-[18px]' : 'left-0.5',
          )}
        />
      </button>
    </label>
  )
}

// ── Right-side drawer ─────────────────────────────────────────────────────
export function Drawer({ title, onClose, children, footer, width = 'max-w-md' }) {
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose?.()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <div className="fixed inset-0 z-[65] flex justify-end bg-black/30" onClick={onClose}>
      <div
        className={cx('flex h-full w-full flex-col border-l border-line bg-white shadow-float', width)}
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center justify-between border-b border-line px-4 py-3">
          <h2 className="text-sm font-semibold text-ink">{title}</h2>
          <button onClick={onClose} className="rounded p-1 text-muted hover:bg-hover" aria-label="Close">
            <X size={18} strokeWidth={1.9} />
          </button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto p-4">{children}</div>
        {footer && <footer className="flex items-center justify-end gap-2 border-t border-line px-4 py-3">{footer}</footer>}
      </div>
    </div>
  )
}

// ── Copy button (shows "Copied" + optional toast hook) ────────────────────
export function CopyButton({ onCopied, label = 'Copy', className }) {
  const [done, setDone] = useState(false)
  return (
    <button
      onClick={() => {
        setDone(true)
        onCopied?.()
        setTimeout(() => setDone(false), 1500)
      }}
      className={cx('inline-flex items-center gap-1 rounded border border-line-mid bg-white px-1.5 py-0.5 text-tiny text-muted hover:bg-hover', className)}
    >
      {done ? <Check size={12} className="text-success-text" /> : <Copy size={12} />} {done ? 'Copied' : label}
    </button>
  )
}

// ── Usage / info banner (inline) ──────────────────────────────────────────
export function Banner({ tone = 'warning', icon: Icon, children, action }) {
  return (
    <div className={cx('flex items-center gap-2.5 rounded-md px-3 py-2 text-sm', TONES[tone])}>
      {Icon && <Icon size={15} strokeWidth={1.9} className="shrink-0" />}
      <span className="flex-1">{children}</span>
      {action}
    </div>
  )
}

// ── Lightweight toast hook ────────────────────────────────────────────────
export function useToast() {
  const [msg, setMsg] = useState(null)
  const show = (m) => {
    setMsg(m)
    setTimeout(() => setMsg(null), 2800)
  }
  return [msg, show]
}
