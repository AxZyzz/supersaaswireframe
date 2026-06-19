import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Plus, BarChart3 } from 'lucide-react'
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend } from 'recharts'
import { ManualLayout } from '../../components/ManualStepper.jsx'
import { Tag, Toggle, Input, Callout, Button, Modal, Toast, useToast, cx } from '../../components/ui.jsx'
import { senderPool, totalSenders, rampStages, senderSchedule } from '../../data/mock2.js'

const tooltipStyle = { border: '1px solid #EBEBEB', borderRadius: 8, fontSize: 12, boxShadow: '0 8px 24px rgba(0,0,0,0.08)' }

export default function Senders() {
  const navigate = useNavigate()
  const [selected, setSelected] = useState(senderPool.slice(0, 7).map((s) => s.email))
  const [rotate, setRotate] = useState(true)
  const [ramp, setRamp] = useState(true)
  const [schedOpen, setSchedOpen] = useState(false)
  const [toast, showToast] = useToast()

  const toggle = (email) => setSelected((s) => (s.includes(email) ? s.filter((x) => x !== email) : [...s, email]))
  const capacity = selected.length * 30

  return (
    <ManualLayout step={2} back="/campaigns/new/setup" next="/campaigns/new/template">
      <div className="mx-auto max-w-3xl p-6">
        <h1 className="text-section font-semibold text-ink">Choose senders & rotation</h1>
        <p className="mt-1 text-sm text-muted">Assign senders from your global pool to this campaign.</p>

        {/* Assignment summary */}
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-line bg-accent-soft px-4 py-3">
          <span className="text-sm font-medium text-accent">{selected.length} of {totalSenders} senders selected</span>
          <div className="flex items-center gap-3 text-tiny text-ink">
            <span>Est. capacity: <span className="font-semibold">{capacity}/day</span> at full ramp</span>
            <Button size="sm" variant="secondary" icon={BarChart3} onClick={() => setSchedOpen(true)}>Preview schedule</Button>
          </div>
        </div>

        {/* Global pool */}
        <div className="mt-4 overflow-hidden rounded-lg border border-line">
          <table className="w-full text-sm">
            <thead className="bg-page text-tiny text-muted">
              <tr className="border-b border-line">
                <th className="w-10 px-3 py-2" />
                <th className="px-3 py-2 text-left font-medium">Email</th>
                <th className="px-3 py-2 text-left font-medium">Provider</th>
                <th className="px-3 py-2 text-left font-medium">Status</th>
                <th className="px-3 py-2 text-right font-medium">Cap</th>
                <th className="px-3 py-2 text-left font-medium">Ramp</th>
              </tr>
            </thead>
            <tbody>
              {senderPool.map((s) => {
                const on = selected.includes(s.email)
                return (
                  <tr key={s.email} onClick={() => toggle(s.email)} className={cx('cursor-pointer border-b border-line last:border-0', on ? 'bg-accent-soft' : 'hover:bg-hover')}>
                    <td className="px-3 py-2.5"><input type="checkbox" checked={on} readOnly className="accent-accent" /></td>
                    <td className="px-3 py-2.5 font-medium text-ink">{s.email}</td>
                    <td className="px-3 py-2.5 text-muted">{s.provider}</td>
                    <td className="px-3 py-2.5"><Tag tone={s.status === 'Verified' ? 'success' : s.status === 'Warming' ? 'info' : 'warning'} dot>{s.status}</Tag></td>
                    <td className="px-3 py-2.5 text-right text-muted">{s.cap}/day</td>
                    <td className="px-3 py-2.5"><Tag tone={s.ramp === 'Mature' ? 'success' : 'neutral'}>{s.ramp}</Tag></td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        <button onClick={() => navigate('/settings?tab=senders')} className="mt-2 flex items-center gap-1.5 text-tiny text-accent hover:underline">
          <Plus size={13} /> Add sender to global pool
        </button>

        {/* Human-like sending */}
        <div className="mt-5 rounded-lg border border-line bg-white p-4">
          <div className="text-sm font-semibold text-ink">Human-like sending</div>
          <div className="mt-3 grid gap-4 sm:grid-cols-2">
            <div className="flex items-center justify-between">
              <span className="text-sm text-ink">Max cap per sender</span>
              <Input type="number" defaultValue={30} className="w-20" />
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-ink">Daily variation</span>
              <span className="text-sm text-muted">30% below cap</span>
            </div>
          </div>
          <div className="mt-4">
            <div className="mb-1.5 text-tiny font-medium text-ink">Ramp stages</div>
            <div className="grid gap-1.5 sm:grid-cols-5">
              {rampStages.map((r) => (
                <div key={r.stage} className="rounded border border-line bg-page px-2 py-1.5 text-center">
                  <div className="text-micro font-medium text-ink">{r.stage}</div>
                  <div className="text-micro text-muted">{r.range}</div>
                </div>
              ))}
            </div>
          </div>
          <div className="mt-4 space-y-3 border-t border-line pt-4">
            <Toggle checked={rotate} onChange={setRotate} label="Rotate between selected senders" hint="Spreads volume so no inbox sends too much." />
            <Toggle checked={ramp} onChange={setRamp} label="Warm ramp-up" hint="Start low and increase gradually to protect deliverability." />
          </div>
        </div>

        <div className="mt-4 flex items-center justify-between">
          <Callout tone="info">Sends are randomized below each cap to look human — not a fixed number every day.</Callout>
        </div>
        <div className="mt-3">
          <Button variant="secondary" onClick={() => showToast(`${selected.length} senders assigned`)}>Assign selected senders</Button>
        </div>
      </div>

      {schedOpen && (
        <Modal title="Preview daily distribution" onClose={() => setSchedOpen(false)} width="max-w-2xl" footer={<Button variant="secondary" onClick={() => setSchedOpen(false)}>Close</Button>}>
          <p className="mb-3 text-sm text-muted">Randomized per-sender volume across the week (sample of 3 senders).</p>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={senderSchedule} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#EBEBEB" vertical={false} />
                <XAxis dataKey="day" tick={{ fontSize: 11, fill: '#666' }} axisLine={{ stroke: '#EBEBEB' }} tickLine={false} />
                <YAxis tick={{ fontSize: 11, fill: '#666' }} axisLine={false} tickLine={false} />
                <Tooltip contentStyle={tooltipStyle} cursor={{ fill: '#F4F4F4' }} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Bar dataKey="s1" name="Sender 1" fill="#3E63DD" radius={[3, 3, 0, 0]} />
                <Bar dataKey="s2" name="Sender 2" fill="#7C3AED" radius={[3, 3, 0, 0]} />
                <Bar dataKey="s3" name="Sender 3" fill="#2A7E3B" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Modal>
      )}
      {toast && <Toast>{toast}</Toast>}
    </ManualLayout>
  )
}
