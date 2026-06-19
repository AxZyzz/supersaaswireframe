import { useState } from 'react'
import { Plus, Globe, Check, AlertTriangle, Trash2 } from 'lucide-react'
import { Field, Input, Textarea, Select, Toggle, Tag, Button, Modal, cx } from './ui.jsx'
import { businessMemory } from '../data/mock2.js'

function AddUrlModal({ onClose, onAdd }) {
  return (
    <Modal
      title="Add website URL"
      onClose={onClose}
      width="max-w-md"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={onAdd}>Add URL</Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="URL"><Input placeholder="businesslab.com/offer" /></Field>
        <Field label="Instruction for AI" hint="What should the assistant use this page for?">
          <Textarea rows={3} placeholder="e.g. Use this page when explaining our pricing." />
        </Field>
      </div>
    </Modal>
  )
}

// Shared AI Business Memory editor — used in onboarding and Settings → AI Memory.
export default function AiMemoryForm({ onToast }) {
  const m = businessMemory
  const [urls, setUrls] = useState(m.urls)
  const [addUrl, setAddUrl] = useState(false)

  const toggleUrl = (i) =>
    setUrls((u) => u.map((x, idx) => (idx === i ? { ...x, usedByAI: !x.usedByAI } : x)))

  return (
    <div className="space-y-5">
      <Field label="Business description">
        <Textarea rows={3} defaultValue={m.description} />
      </Field>

      {/* URLs table */}
      <div>
        <div className="mb-1.5 flex items-center justify-between">
          <span className="text-sm font-medium text-ink">Website URLs</span>
          <Button size="sm" variant="secondary" icon={Plus} onClick={() => setAddUrl(true)}>Add URL</Button>
        </div>
        <div className="overflow-hidden rounded-md border border-line">
          <table className="w-full text-sm">
            <thead className="bg-page text-tiny text-muted">
              <tr className="border-b border-line">
                <th className="px-3 py-2 text-left font-medium">URL</th>
                <th className="px-3 py-2 text-left font-medium">Purpose</th>
                <th className="px-3 py-2 text-center font-medium">Used by AI</th>
                <th className="w-8" />
              </tr>
            </thead>
            <tbody>
              {urls.map((u, i) => (
                <tr key={u.url} className="border-b border-line last:border-0">
                  <td className="px-3 py-2">
                    <span className="flex items-center gap-1.5 text-ink"><Globe size={13} className="text-faint" /> {u.url}</span>
                  </td>
                  <td className="px-3 py-2 text-muted">{u.purpose}</td>
                  <td className="px-3 py-2"><div className="flex justify-center"><Toggle checked={u.usedByAI} onChange={() => toggleUrl(i)} /></div></td>
                  <td className="px-3 py-2"><button className="rounded p-1 text-faint hover:bg-hover hover:text-danger-text"><Trash2 size={13} /></button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Offer"><Input defaultValue={m.offer} /></Field>
        <Field label="Lead magnet"><Input defaultValue={m.leadMagnet} /></Field>
        <Field label="Calendar booking link"><Input defaultValue={m.bookingLink} /></Field>
        <Field label="Tone preference">
          <Select defaultValue={m.tone}>
            <option>Professional but warm</option>
            <option>Professional</option>
            <option>Warm</option>
            <option>Direct</option>
            <option>Friendly</option>
          </Select>
        </Field>
      </div>

      <Field label="Personal context" hint="Optional — helps the AI sound like you.">
        <Textarea rows={2} defaultValue={m.personalContext} />
      </Field>

      {/* Objections */}
      <div>
        <div className="mb-1.5 text-sm font-medium text-ink">Common objections & answers</div>
        <div className="space-y-2">
          {m.objections.map((o, i) => (
            <div key={i} className="rounded-md border border-line bg-page p-3">
              <div className="text-sm font-medium text-ink">{o.q}</div>
              <div className="mt-0.5 text-tiny text-muted">{o.a}</div>
            </div>
          ))}
          <button className="w-full rounded-md border border-dashed border-line-mid px-3 py-2 text-sm text-accent hover:bg-hover">+ Add objection</button>
        </div>
      </div>

      {/* Source health */}
      <div>
        <div className="mb-1.5 text-sm font-medium text-ink">Source health</div>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {m.health.map((h) => (
            <div key={h.label} className={cx('flex items-center gap-2 rounded-md border p-2.5', h.status === 'done' ? 'border-success-bg bg-success-bg' : 'border-warning-bg bg-warning-bg')}>
              {h.status === 'done' ? <Check size={15} className="text-success-text" /> : <AlertTriangle size={15} className="text-warning-text" />}
              <span className={cx('text-tiny font-medium', h.status === 'done' ? 'text-success-text' : 'text-warning-text')}>
                {h.label}{h.status === 'missing' ? ' missing' : ''}
              </span>
            </div>
          ))}
        </div>
      </div>

      {addUrl && (
        <AddUrlModal
          onClose={() => setAddUrl(false)}
          onAdd={() => {
            setAddUrl(false)
            onToast?.('URL added to business memory')
          }}
        />
      )}
    </div>
  )
}
