import { useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import {
  Search,
  Table as TableIcon,
  Columns3,
  SlidersHorizontal,
  MoreHorizontal,
  Plus,
  Tag as TagIcon,
  Trash2,
  ChevronDown,
  RefreshCw,
  List as ListIcon,
  Users,
  Layers,
} from 'lucide-react'
import {
  Segmented,
  FilterChip,
  Tag,
  Avatar,
  Button,
  Toast,
  useToast,
  cx,
} from '../components/ui.jsx'
import ImportLeadsModal from '../components/ImportLeadsModal.jsx'
import CreateListModal from '../components/CreateListModal.jsx'
import { leads, leadStatusTone, tagTone, tintFor, segments } from '../data/mock.js'
import { leadLists, syncHealth } from '../data/mock2.js'

const STATUSES = ['New', 'Contacted', 'Replied', 'Interested', 'Bounced']
const sourceTone = (s) => (s === 'Google Sheet' ? 'success' : s === 'Brilliant Directories' ? 'info' : s === 'REST API' ? 'purple' : 'neutral')
const syncTone = (s) => (s === 'Synced' || s === 'Connected' ? 'success' : s === 'Waiting' ? 'neutral' : 'warning')

export default function Leads() {
  const navigate = useNavigate()
  const location = useLocation()
  const showImport = location.pathname === '/leads/import'
  const [mainView, setMainView] = useState('all')
  const [view, setView] = useState('table')
  const [checked, setChecked] = useState([])
  const [createList, setCreateList] = useState(false)
  const [toast, showToast] = useToast()

  const toggle = (id) => setChecked((c) => (c.includes(id) ? c.filter((x) => x !== id) : [...c, id]))
  const allChecked = checked.length === leads.length

  const onImport = () => {
    navigate('/leads')
    showToast('142 leads imported')
  }
  const startSync = () => {
    setCreateList(false)
    navigate('/leads/lists/hot-leads')
    showToast('Sync started · Hot Leads')
  }

  return (
    <div className="flex h-full flex-col">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2 border-b border-line bg-white px-5 py-2.5">
        <Segmented
          size="sm"
          options={[
            { value: 'all', label: 'All leads', icon: Users },
            { value: 'lists', label: 'Lists', icon: ListIcon },
            { value: 'segments', label: 'Segments', icon: Layers },
          ]}
          value={mainView}
          onChange={setMainView}
        />
        {mainView === 'all' && (
          <>
            <div className="relative">
              <Search size={15} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-faint" />
              <input placeholder="Search leads…" className="h-8 w-48 rounded border border-line-mid bg-white pl-8 pr-2.5 text-sm text-ink placeholder:text-faint focus-ring" />
            </div>
            <FilterChip label="Status" value="All" />
            <FilterChip label="Source" value="All" />
            <FilterChip label="Tag" value="All" />
          </>
        )}
        <div className="ml-auto flex items-center gap-2">
          {mainView === 'all' && (
            <>
              <button className="inline-flex h-8 items-center gap-1.5 rounded border border-line-mid bg-white px-2.5 text-sm text-muted hover:bg-hover">
                <SlidersHorizontal size={14} /> Sort
              </button>
              <Segmented
                size="sm"
                options={[
                  { value: 'table', label: 'Table', icon: TableIcon },
                  { value: 'kanban', label: 'Kanban', icon: Columns3 },
                ]}
                value={view}
                onChange={setView}
              />
              <Button size="sm" variant="primary" icon={Plus} onClick={() => navigate('/leads/import')}>Import leads</Button>
            </>
          )}
          {mainView === 'lists' && <Button size="sm" variant="primary" icon={Plus} onClick={() => setCreateList(true)}>New list</Button>}
        </div>
      </div>

      {/* Bulk action bar */}
      {mainView === 'all' && checked.length > 0 && (
        <div className="flex items-center gap-3 border-b border-line bg-accent-soft px-5 py-2 text-sm">
          <span className="font-medium text-accent">{checked.length} selected</span>
          <Button size="sm" variant="secondary" icon={Plus} onClick={() => navigate('/campaigns/new')}>Add to campaign</Button>
          <Button size="sm" variant="secondary" icon={TagIcon}>Tag</Button>
          <Button size="sm" variant="danger" icon={Trash2}>Delete</Button>
          <button onClick={() => setChecked([])} className="ml-auto text-tiny text-muted hover:text-ink">Clear</button>
        </div>
      )}

      {/* Body */}
      <div className="min-h-0 flex-1 overflow-auto">
        {mainView === 'all' && view === 'table' && (
          <LeadTable leads={leads} checked={checked} allChecked={allChecked} setChecked={setChecked} toggle={toggle} navigate={navigate} />
        )}
        {mainView === 'all' && view === 'kanban' && <KanbanView navigate={navigate} />}
        {mainView === 'lists' && <ListsView navigate={navigate} onSync={(name) => showToast(`Sync complete · ${name}`)} />}
        {mainView === 'segments' && <SegmentsView navigate={navigate} />}
      </div>

      {/* Pagination footer (all-leads table only) */}
      {mainView === 'all' && view === 'table' && (
        <div className="flex items-center justify-between border-t border-line bg-white px-5 py-2.5 text-tiny text-muted">
          <span>1–10 of 12,480</span>
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-1.5">
              Rows per page
              <select className="h-7 rounded border border-line-mid bg-white px-1.5 text-tiny focus-ring"><option>10</option><option>25</option><option>50</option></select>
            </label>
            <div className="flex items-center gap-1">
              <button className="rounded border border-line-mid px-2 py-1 hover:bg-hover">Prev</button>
              <button className="rounded border border-line-mid px-2 py-1 hover:bg-hover">Next</button>
            </div>
          </div>
        </div>
      )}

      {showImport && <ImportLeadsModal onClose={() => navigate('/leads')} onImport={onImport} />}
      {createList && <CreateListModal onClose={() => setCreateList(false)} onStartSync={startSync} onToast={showToast} />}
      {toast && <Toast onClose={() => showToast(null)}>{toast}</Toast>}
    </div>
  )
}

function LeadTable({ leads, checked, allChecked, setChecked, toggle, navigate }) {
  return (
    <table className="w-full text-sm">
      <thead className="sticky top-0 z-10 bg-page">
        <tr className="border-b border-line text-tiny text-muted">
          <th className="w-10 px-4 py-2.5">
            <input type="checkbox" checked={allChecked} onChange={() => setChecked(allChecked ? [] : leads.map((l) => l.id))} className="accent-accent" />
          </th>
          <th className="px-2 py-2.5 text-left font-medium">Name</th>
          <th className="px-3 py-2.5 text-left font-medium">Email</th>
          <th className="px-3 py-2.5 text-left font-medium">Company</th>
          <th className="px-3 py-2.5 text-left font-medium">Tags</th>
          <th className="px-3 py-2.5 text-left font-medium">Source</th>
          <th className="px-3 py-2.5 text-left font-medium">Status</th>
          <th className="px-3 py-2.5 text-left font-medium">Last activity</th>
          <th className="w-10 px-3 py-2.5" />
        </tr>
      </thead>
      <tbody>
        {leads.map((l) => (
          <tr key={l.id} onClick={() => navigate(`/leads/${l.id}`)} className="group cursor-pointer border-b border-line bg-white hover:bg-hover">
            <td className="px-4 py-0" onClick={(e) => e.stopPropagation()}>
              <input type="checkbox" checked={checked.includes(l.id)} onChange={() => toggle(l.id)} className="accent-accent" />
            </td>
            <td className="px-2 py-2.5">
              <div className="flex items-center gap-2.5"><Avatar name={l.name} size={24} tint={tintFor(l.name)} /><span className="font-medium text-ink">{l.name}</span></div>
            </td>
            <td className="px-3 py-2.5 text-muted">{l.email}</td>
            <td className="px-3 py-2.5 text-ink">{l.company}</td>
            <td className="px-3 py-2.5"><div className="flex flex-wrap gap-1">{l.tags.map((t) => <Tag key={t} tone={tagTone(t)}>{t}</Tag>)}</div></td>
            <td className="px-3 py-2.5"><Tag tone="neutral">{l.source}</Tag></td>
            <td className="px-3 py-2.5"><Tag tone={leadStatusTone[l.status]} dot>{l.status}</Tag></td>
            <td className="px-3 py-2.5 text-muted">{l.last}</td>
            <td className="px-3 py-2.5 text-right" onClick={(e) => e.stopPropagation()}>
              <button className="rounded p-1 text-faint opacity-0 hover:bg-hover hover:text-ink group-hover:opacity-100"><MoreHorizontal size={16} /></button>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function ListsView({ navigate, onSync }) {
  return (
    <div className="p-5">
      {/* Sync health */}
      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        {syncHealth.map((h) => (
          <div key={h.source} className="rounded-lg border border-line bg-white p-3">
            <div className="text-tiny text-muted">{h.source}</div>
            <Tag tone={h.tone} dot className="mt-1.5">{h.status}</Tag>
          </div>
        ))}
      </div>

      <div className="overflow-hidden rounded-lg border border-line bg-white">
        <table className="w-full text-sm">
          <thead className="bg-page text-tiny text-muted">
            <tr className="border-b border-line">
              <th className="px-4 py-2.5 text-left font-medium">List</th>
              <th className="px-3 py-2.5 text-left font-medium">Source</th>
              <th className="px-3 py-2.5 text-right font-medium">Leads</th>
              <th className="px-3 py-2.5 text-left font-medium">Sync</th>
              <th className="px-3 py-2.5 text-left font-medium">Last sync</th>
              <th className="px-3 py-2.5 text-left font-medium">Campaign</th>
              <th className="w-24 px-3 py-2.5" />
            </tr>
          </thead>
          <tbody>
            {leadLists.map((l) => (
              <tr key={l.id} onClick={() => navigate(`/leads/lists/${l.id}`)} className="cursor-pointer border-b border-line last:border-0 hover:bg-hover">
                <td className="px-4 py-3 font-medium text-ink">{l.name}</td>
                <td className="px-3 py-3"><Tag tone={sourceTone(l.source)}>{l.source}</Tag></td>
                <td className="px-3 py-3 text-right text-muted">{l.count.toLocaleString()}</td>
                <td className="px-3 py-3"><Tag tone={syncTone(l.sync)} dot>{l.sync}</Tag></td>
                <td className="px-3 py-3 text-muted">{l.lastSync}</td>
                <td className="px-3 py-3 text-muted">{l.campaign}</td>
                <td className="px-3 py-3 text-right" onClick={(e) => e.stopPropagation()}>
                  <Button size="sm" variant="ghost" icon={RefreshCw} onClick={() => onSync(l.name)}>Sync now</Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function SegmentsView({ navigate }) {
  return (
    <div className="grid gap-4 p-5 sm:grid-cols-2 lg:grid-cols-3">
      {segments.map((s) => (
        <button key={s.name} onClick={() => navigate('/leads')} className="rounded-lg border border-line bg-white p-4 text-left hover:border-line-mid">
          <div className="flex items-center justify-between">
            <span className="flex h-8 w-8 items-center justify-center rounded-md bg-accent-soft text-accent"><Layers size={16} /></span>
            <span className="text-tiny text-muted">{s.count} leads</span>
          </div>
          <div className="mt-3 text-sm font-semibold text-ink">{s.name}</div>
          <div className="mt-0.5 text-tiny text-muted">Dynamic segment</div>
        </button>
      ))}
    </div>
  )
}

function KanbanView({ navigate }) {
  return (
    <div className="flex gap-4 p-5">
      {STATUSES.map((status) => {
        const items = leads.filter((l) => l.status === status)
        return (
          <div key={status} className="flex w-64 shrink-0 flex-col rounded-lg border border-line bg-page">
            <div className="flex items-center justify-between border-b border-line px-3 py-2.5">
              <Tag tone={leadStatusTone[status]} dot>{status}</Tag>
              <span className="text-tiny text-muted">{items.length}</span>
            </div>
            <div className="flex flex-col gap-2 p-2">
              {items.map((l) => (
                <button key={l.id} onClick={() => navigate(`/leads/${l.id}`)} className="rounded-md border border-line bg-white p-2.5 text-left hover:border-line-mid hover:shadow-sm">
                  <div className="flex items-center gap-2"><Avatar name={l.name} size={24} tint={tintFor(l.name)} /><span className="text-sm font-medium text-ink">{l.name}</span></div>
                  <div className="mt-1 text-tiny text-muted">{l.company}</div>
                  <div className="mt-1.5 flex flex-wrap gap-1">{l.tags.map((t) => <Tag key={t} tone={tagTone(t)}>{t}</Tag>)}</div>
                </button>
              ))}
              {!items.length && <div className="px-2 py-4 text-center text-tiny text-faint">No leads</div>}
            </div>
          </div>
        )
      })}
    </div>
  )
}
