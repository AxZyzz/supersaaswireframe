import { useNavigate } from 'react-router-dom'
import { Plus, MoreHorizontal } from 'lucide-react'
import { Tag, Button, FilterChip, Avatar } from '../components/ui.jsx'
import { campaigns, campaignStatusTone } from '../data/mock.js'

export default function Campaigns() {
  const navigate = useNavigate()
  return (
    <div className="mx-auto max-w-[1280px] p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <FilterChip label="Status" value="All" />
          <FilterChip label="Sender" value="All" />
          <FilterChip label="Date" value="Last 90 days" />
        </div>
        <Button variant="primary" icon={Plus} onClick={() => navigate('/campaigns/new')}>New campaign</Button>
      </div>

      <div className="mt-4 overflow-hidden rounded-lg border border-line bg-white">
        <table className="w-full text-sm">
          <thead className="bg-page text-tiny text-muted">
            <tr className="border-b border-line">
              <th className="px-4 py-2.5 text-left font-medium">Name</th>
              <th className="px-3 py-2.5 text-left font-medium">Status</th>
              <th className="px-3 py-2.5 text-left font-medium">Segment</th>
              <th className="px-3 py-2.5 text-left font-medium">Senders</th>
              <th className="px-3 py-2.5 text-right font-medium">Sent</th>
              <th className="px-3 py-2.5 text-right font-medium">Open %</th>
              <th className="px-3 py-2.5 text-right font-medium">Reply %</th>
              <th className="px-3 py-2.5 text-left font-medium">Created</th>
              <th className="w-10 px-3 py-2.5" />
            </tr>
          </thead>
          <tbody>
            {campaigns.map((c) => (
              <tr
                key={c.id}
                onClick={() => navigate(`/campaigns/${c.id}`)}
                className="group cursor-pointer border-b border-line last:border-0 hover:bg-hover"
              >
                <td className="px-4 py-3 font-medium text-ink">{c.name}</td>
                <td className="px-3 py-3"><Tag tone={campaignStatusTone[c.status]} dot>{c.status}</Tag></td>
                <td className="px-3 py-3 text-ink">{c.segment}</td>
                <td className="px-3 py-3 text-muted">{c.senders ? `${c.senders} sender${c.senders > 1 ? 's' : ''}` : '—'}</td>
                <td className="px-3 py-3 text-right text-muted">{c.sent ? c.sent.toLocaleString() : '—'}</td>
                <td className="px-3 py-3 text-right text-muted">{c.open != null ? `${c.open}%` : '—'}</td>
                <td className="px-3 py-3 text-right text-muted">{c.reply != null ? `${c.reply}%` : '—'}</td>
                <td className="px-3 py-3 text-muted">{c.created}</td>
                <td className="px-3 py-3 text-right" onClick={(e) => e.stopPropagation()}>
                  <button className="rounded p-1 text-faint opacity-0 hover:bg-hover hover:text-ink group-hover:opacity-100">
                    <MoreHorizontal size={16} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
