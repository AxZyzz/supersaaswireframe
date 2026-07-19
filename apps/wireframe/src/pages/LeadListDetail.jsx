import { useState } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { ChevronRight, RefreshCw, MoreHorizontal, Plus } from 'lucide-react'
import { Tag, Avatar, Button, Toast, useToast, cx } from '../components/ui.jsx'
import { leads, leadStatusTone, tagTone, tintFor } from '../data/mock.js'
import { leadListById } from '../data/mock2.js'

const sourceTone = (s) => (s === 'Google Sheet' ? 'success' : s === 'Brilliant Directories' ? 'info' : s === 'REST API' ? 'purple' : 'neutral')
const syncTone = (s) => (s === 'Synced' || s === 'Connected' ? 'success' : s === 'Waiting' ? 'neutral' : 'warning')

export default function LeadListDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const list = leadListById(id)
  const [lastSync, setLastSync] = useState(list.lastSync)
  const [toast, showToast] = useToast()

  const rows = list.count === 0 ? [] : leads

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="border-b border-line bg-white px-5 py-3">
        <div className="flex items-center gap-1.5 text-sm text-muted">
          <Link to="/leads" className="hover:text-ink">Leads</Link>
          <ChevronRight size={14} className="text-faint" />
          <span className="text-muted">Lists</span>
          <ChevronRight size={14} className="text-faint" />
          <span className="font-medium text-ink">{list.name}</span>
        </div>
        <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <h1 className="text-section font-semibold text-ink">{list.name}</h1>
            <Tag tone={sourceTone(list.source)}>{list.source}</Tag>
            <Tag tone={syncTone(list.sync)} dot>{list.sync}</Tag>
            <span className="text-tiny text-muted">{list.count.toLocaleString()} leads · last sync {lastSync}</span>
          </div>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="secondary" icon={RefreshCw} onClick={() => { setLastSync('just now'); showToast('Sync complete') }}>Sync now</Button>
            <Button size="sm" variant="primary" icon={Plus} onClick={() => navigate('/campaigns/new')}>Use in campaign</Button>
          </div>
        </div>
      </div>

      {/* Table */}
      <div className="min-h-0 flex-1 overflow-auto">
        {rows.length === 0 ? (
          <div className="flex flex-col items-center justify-center px-6 py-20 text-center">
            <div className="mb-3 rounded-full bg-panel p-3 text-faint"><RefreshCw size={26} strokeWidth={1.5} /></div>
            <div className="text-sm font-semibold text-ink">Waiting for first request</div>
            <div className="mt-1 max-w-xs text-sm text-muted">Leads will appear here as your system posts them to the API endpoint.</div>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="sticky top-0 z-10 bg-page">
              <tr className="border-b border-line text-tiny text-muted">
                <th className="px-4 py-2.5 text-left font-medium">Name</th>
                <th className="px-3 py-2.5 text-left font-medium">Email</th>
                <th className="px-3 py-2.5 text-left font-medium">Company</th>
                <th className="px-3 py-2.5 text-left font-medium">Tags</th>
                <th className="px-3 py-2.5 text-left font-medium">Status</th>
                <th className="px-3 py-2.5 text-left font-medium">Last activity</th>
                <th className="w-10 px-3 py-2.5" />
              </tr>
            </thead>
            <tbody>
              {rows.map((l) => (
                <tr key={l.id} onClick={() => navigate(`/leads/${l.id}`)} className="group cursor-pointer border-b border-line bg-white hover:bg-hover">
                  <td className="px-4 py-2.5"><div className="flex items-center gap-2.5"><Avatar name={l.name} size={24} tint={tintFor(l.name)} /><span className="font-medium text-ink">{l.name}</span></div></td>
                  <td className="px-3 py-2.5 text-muted">{l.email}</td>
                  <td className="px-3 py-2.5 text-ink">{l.company}</td>
                  <td className="px-3 py-2.5"><div className="flex flex-wrap gap-1">{l.tags.map((t) => <Tag key={t} tone={tagTone(t)}>{t}</Tag>)}</div></td>
                  <td className="px-3 py-2.5"><Tag tone={leadStatusTone[l.status]} dot>{l.status}</Tag></td>
                  <td className="px-3 py-2.5 text-muted">{l.last}</td>
                  <td className="px-3 py-2.5 text-right"><button className="rounded p-1 text-faint opacity-0 hover:bg-hover hover:text-ink group-hover:opacity-100"><MoreHorizontal size={16} /></button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {toast && <Toast>{toast}</Toast>}
    </div>
  )
}
