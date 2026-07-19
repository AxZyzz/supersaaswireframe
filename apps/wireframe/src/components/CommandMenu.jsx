import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Search,
  LayoutDashboard,
  Users,
  Send,
  Inbox,
  FileText,
  BarChart3,
  Upload,
  Sparkles,
  CornerDownLeft,
  BookOpen,
} from 'lucide-react'

const GROUPS = [
  {
    heading: 'Navigation',
    items: [
      { label: 'Go to Dashboard', icon: LayoutDashboard, to: '/dashboard' },
      { label: 'Go to Leads', icon: Users, to: '/leads' },
      { label: 'Go to Campaigns', icon: Send, to: '/campaigns' },
      { label: 'Open inbox', icon: Inbox, to: '/inbox' },
      { label: 'Go to Templates', icon: FileText, to: '/templates' },
      { label: 'Go to Analytics', icon: BarChart3, to: '/analytics' },
    ],
  },
  {
    heading: 'Actions',
    items: [
      { label: 'New campaign', icon: Send, to: '/campaigns/new' },
      { label: 'Build campaign with AI', icon: Sparkles, to: '/campaigns/new/ai' },
      { label: 'Import leads', icon: Upload, to: '/leads/import' },
    ],
  },
  {
    heading: 'Help',
    items: [
      { label: 'Open documentation', icon: BookOpen, to: '/docs' },
      { label: 'How to create a campaign', icon: BookOpen, to: '/docs' },
      { label: 'How to connect senders', icon: BookOpen, to: '/docs' },
      { label: 'How to read analytics', icon: BookOpen, to: '/docs' },
    ],
  },
]

export default function CommandMenu({ open, onClose }) {
  const navigate = useNavigate()
  const [q, setQ] = useState('')

  useEffect(() => {
    if (!open) setQ('')
  }, [open])

  if (!open) return null

  const go = (to) => {
    onClose()
    navigate(to)
  }

  const filtered = GROUPS.map((g) => ({
    ...g,
    items: g.items.filter((i) => i.label.toLowerCase().includes(q.toLowerCase())),
  })).filter((g) => g.items.length)

  return (
    <div className="fixed inset-0 z-[70] flex items-start justify-center bg-black/30 p-6 pt-[12vh]" onClick={onClose}>
      <div
        className="w-full max-w-xl overflow-hidden rounded-lg border border-line bg-white shadow-float"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2.5 border-b border-line px-3.5">
          <Search size={16} className="text-faint" />
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search or jump to…"
            className="h-12 w-full bg-transparent text-sm text-ink outline-none placeholder:text-faint"
          />
          <kbd className="rounded border border-line-mid px-1.5 py-0.5 text-micro text-faint">Esc</kbd>
        </div>
        <div className="max-h-80 overflow-y-auto py-2">
          {filtered.map((g) => (
            <div key={g.heading} className="px-2 pb-1">
              <div className="px-2 py-1 text-micro font-medium uppercase tracking-wide text-faint">{g.heading}</div>
              {g.items.map((i) => (
                <button
                  key={i.label}
                  onClick={() => go(i.to)}
                  className="group flex w-full items-center gap-2.5 rounded px-2 py-2 text-sm text-ink hover:bg-hover"
                >
                  <i.icon size={16} strokeWidth={1.9} className="text-muted" />
                  <span className="flex-1 text-left">{i.label}</span>
                  <CornerDownLeft size={14} className="text-faint opacity-0 group-hover:opacity-100" />
                </button>
              ))}
            </div>
          ))}
          {!filtered.length && <div className="px-4 py-6 text-center text-sm text-muted">No matches.</div>}
        </div>
      </div>
    </div>
  )
}
