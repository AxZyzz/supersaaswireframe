import { useNavigate } from 'react-router-dom'
import { Search, Plus, MoreHorizontal, FileText, Copy, Pencil, Trash2 } from 'lucide-react'
import { Button, FilterChip } from '../components/ui.jsx'
import { templates } from '../data/mock.js'

function MiniMail() {
  return (
    <div className="rounded-md border border-line bg-page p-2.5">
      <div className="h-1.5 w-2/3 rounded bg-line-mid" />
      <div className="mt-2 space-y-1">
        <div className="h-1 w-full rounded bg-line" />
        <div className="h-1 w-5/6 rounded bg-line" />
        <div className="h-1 w-4/6 rounded bg-line" />
      </div>
    </div>
  )
}

export default function Templates() {
  const navigate = useNavigate()
  return (
    <div className="mx-auto max-w-[1280px] p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search size={15} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-faint" />
            <input
              placeholder="Search templates…"
              className="h-8 w-56 rounded border border-line-mid bg-white pl-8 pr-2.5 text-sm text-ink placeholder:text-faint focus-ring"
            />
          </div>
          <FilterChip label="Tag" value="All" />
        </div>
        <Button variant="primary" icon={Plus} onClick={() => navigate('/templates/editor')}>New template</Button>
      </div>

      <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {templates.map((t) => (
          <div
            key={t.id}
            className="group flex flex-col rounded-lg border border-line bg-white p-4 transition-colors hover:border-line-mid"
          >
            <div className="flex items-start justify-between">
              <span className="flex h-8 w-8 items-center justify-center rounded-md bg-accent-soft text-accent">
                <FileText size={16} strokeWidth={1.9} />
              </span>
              <div className="flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
                <button onClick={() => navigate('/templates/editor')} className="rounded p-1.5 text-muted hover:bg-hover hover:text-ink"><Pencil size={14} /></button>
                <button className="rounded p-1.5 text-muted hover:bg-hover hover:text-ink"><Copy size={14} /></button>
                <button className="rounded p-1.5 text-muted hover:bg-hover hover:text-danger-text"><Trash2 size={14} /></button>
              </div>
            </div>
            <button onClick={() => navigate('/templates/editor')} className="mt-3 text-left">
              <div className="text-sm font-semibold text-ink">{t.name}</div>
              <div className="mt-0.5 truncate text-tiny text-muted">{t.subject}</div>
            </button>
            <div className="mt-3"><MiniMail /></div>
            <div className="mt-3 flex items-center justify-between border-t border-line pt-3 text-tiny text-muted">
              <span>Edited {t.edited}</span>
              <span>Used in {t.usedIn} campaign{t.usedIn > 1 ? 's' : ''}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
