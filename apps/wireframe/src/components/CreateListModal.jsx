import { useState } from 'react'
import { Plus, X, Copy } from 'lucide-react'
import { Modal, Tabs, Field, Input, Select, Button, Tag, Callout, CopyButton, cx } from './ui.jsx'
import { listSourceTabs } from '../data/mock2.js'

const PREVIEW = [
  { name: 'Ella Roberts', email: 'ella@robertsclinic.com', company: 'Roberts Clinic' },
  { name: 'Sam Wu', email: 'sam@wulegal.com', company: 'Wu Legal' },
  { name: 'Nadia Khan', email: 'nadia@khanspa.com', company: 'Khan Spa' },
]

export default function CreateListModal({ onClose, onStartSync, onToast }) {
  const [source, setSource] = useState('Google Sheet')
  const [customFields, setCustomFields] = useState(['Plan tier'])

  const primaryLabel = source === 'REST API' ? 'Done' : 'Start sync'

  return (
    <Modal
      title="Create lead list"
      onClose={onClose}
      width="max-w-3xl"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={onStartSync}>{primaryLabel}</Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="List name"><Input defaultValue="Hot Leads" /></Field>

        <div>
          <div className="mb-1.5 text-sm font-medium text-ink">Source</div>
          <Tabs tabs={listSourceTabs} active={source} onChange={setSource} />
        </div>

        <div className="pt-1">
          {source === 'CSV / Excel' && (
            <Callout tone="info">One-time import from a spreadsheet file. Map columns, preview, then add to this list.</Callout>
          )}
          {source === 'Google Sheet' && (
            <div className="space-y-3">
              <Field label="Google Sheet URL"><Input defaultValue="https://docs.google.com/spreadsheets/d/1aB…/edit" /></Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Map columns"><Select defaultValue="Auto-detected"><option>Auto-detected</option><option>Manual</option></Select></Field>
                <Field label="Sync frequency"><Select defaultValue="Every 15 min (ongoing)"><option>Every 15 min (ongoing)</option><option>Hourly</option><option>One-time</option></Select></Field>
              </div>
              <PreviewTable />
              <Callout tone="success">Ongoing sync — new and changed rows flow into this list automatically.</Callout>
            </div>
          )}
          {source === 'Brilliant Directories' && (
            <div className="space-y-3">
              <Field label="Site URL"><Input defaultValue="members.businesslab.com" /></Field>
              <Field label="API key / plugin bridge">
                <div className="flex items-center gap-2"><Input defaultValue="bd_live_••••••3f9a" className="flex-1" /><Tag tone="success" dot>Bridge connected</Tag></div>
              </Field>
              <div className="flex gap-2">
                <Button size="sm" variant="secondary" onClick={() => onToast?.('Sample records fetched')}>Fetch sample records</Button>
              </div>
              <Callout tone="info">Ongoing sync — member changes (new, updated, removed) keep this list current.</Callout>
            </div>
          )}
          {source === 'REST API' && (
            <div className="space-y-3">
              <div>
                <div className="mb-1.5 text-sm font-medium text-ink">Endpoint</div>
                <div className="flex items-center justify-between rounded-md border border-line bg-page px-3 py-2 font-mono text-tiny text-ink">
                  POST https://api.businesslab.com/v1/lists/hot-leads/leads
                  <CopyButton onCopied={() => onToast?.('Endpoint copied')} />
                </div>
              </div>
              <div>
                <div className="mb-1.5 text-sm font-medium text-ink">API key</div>
                <div className="flex items-center justify-between rounded-md border border-line bg-page px-3 py-2 font-mono text-tiny text-ink">
                  bl_live_••••••••3f9a
                  <CopyButton onCopied={() => onToast?.('API key copied')} />
                </div>
              </div>
              <Callout tone="neutral">Waiting for first request — leads appear here as your system posts them.</Callout>
            </div>
          )}
        </div>

        {/* Required fields */}
        <div className="border-t border-line pt-4">
          <div className="mb-1.5 text-sm font-medium text-ink">Required fields</div>
          <div className="flex flex-wrap gap-1.5">
            {['First name', 'Last name', 'Email', 'Phone', 'Company'].map((f) => (
              <Tag key={f} tone="neutral">{f}</Tag>
            ))}
          </div>
        </div>

        {/* Custom fields / tags / statuses */}
        <div className="grid gap-4 sm:grid-cols-3">
          <div>
            <div className="mb-1.5 text-sm font-medium text-ink">Custom fields</div>
            <div className="flex flex-wrap gap-1.5">
              {customFields.map((f) => (
                <span key={f} className="inline-flex items-center gap-1 rounded-full bg-accent-soft px-2 py-0.5 text-tiny text-accent">
                  {f}<button onClick={() => setCustomFields((c) => c.filter((x) => x !== f))}><X size={11} /></button>
                </span>
              ))}
              <button onClick={() => setCustomFields((c) => [...c, `Field ${c.length + 1}`])} className="rounded-full border border-dashed border-line-mid px-2 py-0.5 text-tiny text-muted hover:bg-hover">+ field</button>
            </div>
          </div>
          <div>
            <div className="mb-1.5 text-sm font-medium text-ink">Custom tags</div>
            <div className="flex flex-wrap gap-1.5"><Tag tone="danger">Hot</Tag><Tag tone="info">Dentist</Tag></div>
          </div>
          <div>
            <div className="mb-1.5 text-sm font-medium text-ink">Custom statuses</div>
            <div className="flex flex-wrap gap-1.5"><Tag tone="neutral">New</Tag><Tag tone="success">Converted</Tag></div>
          </div>
        </div>
      </div>
    </Modal>
  )
}

function PreviewTable() {
  return (
    <div>
      <div className="mb-1.5 text-sm font-medium text-ink">Preview · first 3 of 10 rows</div>
      <div className="overflow-hidden rounded-md border border-line">
        <table className="w-full text-tiny">
          <thead className="bg-page text-muted">
            <tr><th className="px-3 py-1.5 text-left font-medium">Name</th><th className="px-3 py-1.5 text-left font-medium">Email</th><th className="px-3 py-1.5 text-left font-medium">Company</th></tr>
          </thead>
          <tbody>
            {PREVIEW.map((r) => (
              <tr key={r.email} className="border-t border-line"><td className="px-3 py-1.5 text-ink">{r.name}</td><td className="px-3 py-1.5 text-muted">{r.email}</td><td className="px-3 py-1.5 text-muted">{r.company}</td></tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
