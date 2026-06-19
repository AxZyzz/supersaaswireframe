import { useState } from 'react'
import { UploadCloud, Copy, Info, Tag as TagIcon } from 'lucide-react'
import { Modal, Button, Input, Select, Tabs, Callout, Tag } from './ui.jsx'

const PREVIEW = [
  { name: 'Ella Roberts', email: 'ella@robertsclinic.com', company: 'Roberts Clinic' },
  { name: 'Sam Wu', email: 'sam@wulegal.com', company: 'Wu Legal' },
  { name: 'Nadia Khan', email: 'nadia@khanspa.com', company: 'Khan Spa' },
]
const CSV_COLS = ['Full Name', 'Email Address', 'Company', 'Category']
const FIELDS = ['Name', 'Email', 'Company', 'Tag', 'Skip']

export default function ImportLeadsModal({ onClose, onImport }) {
  const [tab, setTab] = useState('CSV Upload')

  return (
    <Modal
      title="Import leads"
      onClose={onClose}
      width="max-w-3xl"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={onImport}>
            {tab === 'REST API' ? 'Done' : 'Import 142 leads'}
          </Button>
        </>
      }
    >
      <Tabs
        tabs={['CSV Upload', 'Google Sheet', 'REST API', 'Brilliant Directories']}
        active={tab}
        onChange={setTab}
      />

      <div className="pt-4">
        {tab === 'CSV Upload' && (
          <div className="space-y-4">
            <button className="flex w-full flex-col items-center gap-1.5 rounded-md border border-dashed border-line-mid bg-panel py-8 text-muted hover:bg-hover">
              <UploadCloud size={24} strokeWidth={1.6} />
              <span className="text-sm">Drag a .csv here or browse</span>
              <span className="text-tiny text-faint">leads-march.csv · 142 rows detected</span>
            </button>

            <div>
              <div className="mb-2 text-sm font-medium text-ink">Map columns</div>
              <div className="overflow-hidden rounded-md border border-line">
                <table className="w-full text-sm">
                  <thead className="bg-page text-tiny text-muted">
                    <tr>
                      <th className="px-3 py-2 text-left font-medium">CSV column</th>
                      <th className="px-3 py-2 text-left font-medium">Maps to field</th>
                    </tr>
                  </thead>
                  <tbody>
                    {CSV_COLS.map((c, i) => (
                      <tr key={c} className="border-t border-line">
                        <td className="px-3 py-2 font-mono text-tiny text-ink">{c}</td>
                        <td className="px-3 py-2">
                          <Select defaultValue={FIELDS[i]} className="h-8 w-48">
                            {FIELDS.map((f) => (
                              <option key={f}>{f}</option>
                            ))}
                          </Select>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div>
              <div className="mb-2 text-sm font-medium text-ink">First 3 rows preview</div>
              <div className="overflow-hidden rounded-md border border-line">
                <table className="w-full text-tiny">
                  <thead className="bg-page text-muted">
                    <tr>
                      <th className="px-3 py-1.5 text-left font-medium">Name</th>
                      <th className="px-3 py-1.5 text-left font-medium">Email</th>
                      <th className="px-3 py-1.5 text-left font-medium">Company</th>
                    </tr>
                  </thead>
                  <tbody>
                    {PREVIEW.map((r) => (
                      <tr key={r.email} className="border-t border-line">
                        <td className="px-3 py-1.5 text-ink">{r.name}</td>
                        <td className="px-3 py-1.5 text-muted">{r.email}</td>
                        <td className="px-3 py-1.5 text-muted">{r.company}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <TagOnImport />
          </div>
        )}

        {tab === 'Google Sheet' && (
          <div className="space-y-4">
            <div className="flex items-end gap-2">
              <div className="flex-1">
                <div className="mb-1.5 text-sm font-medium text-ink">Google Sheet URL</div>
                <Input defaultValue="https://docs.google.com/spreadsheets/d/1aB…/edit" />
              </div>
              <Button variant="secondary">Connect Google</Button>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <div className="mb-1.5 text-sm font-medium text-ink">Sheet</div>
                <Select defaultValue="Leads Q2"><option>Leads Q2</option><option>Master list</option></Select>
              </div>
              <div>
                <div className="mb-1.5 text-sm font-medium text-ink">Tab</div>
                <Select defaultValue="Imported"><option>Imported</option><option>Raw</option></Select>
              </div>
            </div>
            <Callout tone="info" icon={Info}>Columns will be auto-mapped from the header row. You can adjust after connecting.</Callout>
            <TagOnImport />
          </div>
        )}

        {tab === 'REST API' && (
          <div className="space-y-4">
            <div>
              <div className="mb-1.5 text-sm font-medium text-ink">Endpoint</div>
              <div className="flex items-center justify-between rounded-md border border-line bg-panel px-3 py-2 font-mono text-tiny text-ink">
                POST https://api.businesslab.com/v1/leads
                <button className="flex items-center gap-1 text-muted hover:text-ink"><Copy size={12} /> Copy</button>
              </div>
            </div>
            <div>
              <div className="mb-1.5 text-sm font-medium text-ink">API key</div>
              <div className="flex items-center justify-between rounded-md border border-line bg-panel px-3 py-2 font-mono text-tiny text-ink">
                bl_live_••••••••••••3f9a
                <button className="flex items-center gap-1 text-muted hover:text-ink"><Copy size={12} /> Copy</button>
              </div>
            </div>
            <div>
              <div className="mb-1.5 text-sm font-medium text-ink">Example request</div>
              <pre className="overflow-x-auto rounded-md border border-line bg-ink2 p-3 text-tiny leading-relaxed text-white">
{`curl -X POST https://api.businesslab.com/v1/leads \\
  -H "Authorization: Bearer bl_live_…3f9a" \\
  -H "Content-Type: application/json" \\
  -d '{ "name": "Anita Sharma",
        "email": "anita@brightdental.com",
        "company": "Bright Dental",
        "tags": ["Hot","Dentist"] }'`}
              </pre>
            </div>
          </div>
        )}

        {tab === 'Brilliant Directories' && (
          <div className="space-y-4">
            <p className="text-sm leading-relaxed text-muted">
              Sync members directly from your Brilliant Directories site. New and updated members flow into your leads
              automatically once connected.
            </p>
            <div className="flex items-center gap-3">
              <Button variant="secondary">Connect Brilliant Directories</Button>
              <Tag tone="warning" dot>Coordination required</Tag>
            </div>
            <Callout tone="warning" icon={Info}>
              This connection needs a one-time setup with your directory admin. Our team will coordinate the API
              handshake before sync begins.
            </Callout>
            <TagOnImport />
          </div>
        )}
      </div>
    </Modal>
  )
}

function TagOnImport() {
  return (
    <div className="flex items-center gap-2 rounded-md border border-line bg-page px-3 py-2.5">
      <TagIcon size={15} className="text-muted" />
      <span className="text-sm text-ink">Tag this batch</span>
      <Input defaultValue="March import" className="ml-auto h-8 w-40" />
    </div>
  )
}
