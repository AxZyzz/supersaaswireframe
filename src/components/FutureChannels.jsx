import { useState } from 'react'
import { Mail, MessageSquare, Phone, Send, FileText } from 'lucide-react'
import { Card, Modal, Button, Tag, Toast, useToast, cx } from './ui.jsx'
import { futureChannels } from '../data/mock2.js'

const ICON = { Email: Mail, SMS: MessageSquare, WhatsApp: Send, 'Inland letter': FileText, 'AI calling / reception': Phone }

export default function FutureChannels({ title = 'Channels' }) {
  const [picked, setPicked] = useState(null)
  const [toast, showToast] = useToast()
  return (
    <Card title={title}>
      <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-5">
        {futureChannels.map((c) => {
          const Icon = ICON[c.name] || Mail
          const active = c.status === 'Active'
          return (
            <button
              key={c.name}
              onClick={() => (active ? null : setPicked(c))}
              className={cx(
                'flex flex-col items-start gap-2 rounded-md border p-3 text-left transition-colors',
                active ? 'border-accent bg-accent-soft' : 'border-line bg-page opacity-70 hover:opacity-100',
              )}
            >
              <Icon size={18} strokeWidth={1.9} className={active ? 'text-accent' : 'text-muted'} />
              <span className="text-sm font-medium text-ink">{c.name}</span>
              <Tag tone={active ? 'success' : 'neutral'} dot={active}>{c.status}</Tag>
            </button>
          )
        })}
      </div>

      {picked && (
        <Modal
          title={picked.name}
          onClose={() => setPicked(null)}
          width="max-w-md"
          footer={
            <>
              <Button variant="secondary" onClick={() => setPicked(null)}>Close</Button>
              <Button variant="primary" onClick={() => { setPicked(null); showToast(`${picked.name} added to roadmap`) }}>Add to roadmap</Button>
            </>
          }
        >
          <p className="text-sm text-ink">Roadmap feature. Not active in this prototype.</p>
          <p className="mt-2 text-tiny text-muted">Email is the only active channel for the V1 demo. {picked.name} is acknowledged on the roadmap and will not enter the campaign builder yet.</p>
        </Modal>
      )}
      {toast && <Toast>{toast}</Toast>}
    </Card>
  )
}
