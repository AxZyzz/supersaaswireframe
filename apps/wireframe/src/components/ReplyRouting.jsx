import { useState } from 'react'
import { Mail, Users, Check, Forward, Copy, PlayCircle } from 'lucide-react'
import { Card, Modal, Button, Field, Input, Textarea, Tag, Callout, CopyButton, cx } from './ui.jsx'

function RoutingModal({ mode, setMode, onClose }) {
  return (
    <Modal
      title="Configure reply routing"
      onClose={onClose}
      width="max-w-2xl"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={onClose}>Save routing</Button>
        </>
      }
    >
      <p className="mb-4 text-sm text-muted">When a lead replies, how should the conversation continue?</p>
      <div className="grid gap-3 md:grid-cols-2">
        <button
          onClick={() => setMode('same')}
          className={cx('relative rounded-md border p-4 text-left', mode === 'same' ? 'border-accent bg-accent-soft' : 'border-line-mid hover:bg-hover')}
        >
          {mode === 'same' && <Check size={16} className="absolute right-3 top-3 text-accent" strokeWidth={2.4} />}
          <span className="flex h-9 w-9 items-center justify-center rounded-md bg-white text-accent"><Mail size={18} /></span>
          <div className="mt-3 text-sm font-medium text-ink">Same sender continues</div>
          <p className="mt-1 text-tiny text-muted">
            If the lead replied to email3@domain.com, the platform keeps replying from email3@domain.com. Best for continuity and sender consistency.
          </p>
        </button>
        <button
          onClick={() => setMode('central')}
          className={cx('relative rounded-md border p-4 text-left', mode === 'central' ? 'border-accent bg-accent-soft' : 'border-line-mid hover:bg-hover')}
        >
          {mode === 'central' && <Check size={16} className="absolute right-3 top-3 text-accent" strokeWidth={2.4} />}
          <span className="flex h-9 w-9 items-center justify-center rounded-md bg-white text-accent"><Users size={18} /></span>
          <div className="mt-3 text-sm font-medium text-ink">Central human handoff</div>
          <p className="mt-1 text-tiny text-muted">
            First response sends a handoff note and CCs the main person. Future replies move into the main inbox. Best when a person continues personally.
          </p>
        </button>
      </div>

      {mode === 'central' && (
        <div className="mt-4 space-y-3 rounded-md border border-line bg-panel p-4">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Main reply-to email"><Input defaultValue="yakin@businesslab.com" /></Field>
            <Field label="CC owner"><Input defaultValue="team@businesslab.com" /></Field>
          </div>
          <Field label="Handoff message preview">
            <Textarea rows={2} defaultValue="Hi {{first_name}}, looping in Yakin who'll take it from here — he can answer anything specific to {{company}}." />
          </Field>
        </div>
      )}
    </Modal>
  )
}

export default function ReplyRouting({ onToast, compact }) {
  const [open, setOpen] = useState(false)
  const [mode, setMode] = useState('same')

  return (
    <Card title="Reply routing">
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm text-ink">Current mode</div>
            <Tag tone={mode === 'same' ? 'success' : 'info'} dot className="mt-1">
              {mode === 'same' ? 'Same sender continues' : 'Central human handoff'}
            </Tag>
          </div>
          <Button variant="secondary" onClick={() => setOpen(true)}>Configure reply routing</Button>
        </div>

        {!compact && (
          <div className="space-y-3 border-t border-line pt-4">
            <div className="text-sm font-medium text-ink">Forwarding & BCC tracking</div>
            <Callout tone="info" icon={Forward}>
              Forward all sender inboxes into one platform inbox so replies sent outside the platform don’t lose context.
            </Callout>
            <div className="flex items-center justify-between rounded-md border border-line bg-page px-3 py-2">
              <span className="font-mono text-tiny text-ink">bcc-track-3f9a@inbox.businesslab.com</span>
              <CopyButton label="Copy BCC address" onCopied={() => onToast?.('BCC address copied')} />
            </div>
            <div className="flex gap-2">
              <Button size="sm" variant="ghost" icon={PlayCircle}>Watch setup video</Button>
              <Button size="sm" variant="ghost">Help docs</Button>
            </div>
          </div>
        )}
      </div>

      {open && <RoutingModal mode={mode} setMode={setMode} onClose={() => setOpen(false)} />}
    </Card>
  )
}
