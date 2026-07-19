import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Search,
  Archive,
  Clock,
  MoreHorizontal,
  Sparkles,
  Bold,
  Italic,
  Link2,
  List,
  ExternalLink,
  Info,
  Check,
  Pencil,
  Zap,
  CalendarClock,
} from 'lucide-react'
import { Tag, Avatar, Button, Modal, Toast, useToast, cx } from '../components/ui.jsx'
import { conversations, leadById, tagTone, tintFor } from '../data/mock.js'
import { replyClasses } from '../data/mock2.js'

const FILTERS = ['All', 'Unread', 'Interested', 'Needs review']
const classTone = (key) => replyClasses.find((c) => c.key === key)?.tone || 'neutral'

export default function Inbox() {
  const navigate = useNavigate()
  const [selectedId, setSelectedId] = useState(conversations[0].id)
  const [filter, setFilter] = useState('All')
  const [reply, setReply] = useState('')
  const [sent, setSent] = useState(false)
  const [draftMeta, setDraftMeta] = useState(null) // {confidence, learning}
  const [approvals, setApprovals] = useState(7)
  const [autoPrompt, setAutoPrompt] = useState(false)
  const [confirmAuto, setConfirmAuto] = useState(false)
  const [autoCats, setAutoCats] = useState(['Not interested'])
  const [srcTip, setSrcTip] = useState(false)
  const [appliedAction, setAppliedAction] = useState(false)
  const [toast, showToast] = useToast()

  const convo = conversations.find((c) => c.id === selectedId)
  const lead = leadById(convo.leadId)
  const [klass, setKlass] = useState(convo.classification)
  const sourceSender = convo.thread.find((m) => m.dir === 'out')?.from || 'outreach@businesslab.com'

  const selectConvo = (id) => {
    const c = conversations.find((x) => x.id === id)
    setSelectedId(id)
    setKlass(c.classification)
    setReply('')
    setSent(false)
    setDraftMeta(null)
    setAppliedAction(false)
  }

  const aiDraft = () => {
    setReply(
      `Hi ${convo.name.split(' ')[0]},\n\nThanks so much for the quick reply — great to hear there's interest. How does a 15-minute call this Thursday or Friday sound? You can grab a slot here: cal.com/businesslab/demo.\n\nBest,\nYakin`,
    )
    setDraftMeta({ confidence: 82, learning: false })
  }

  const approveSend = () => {
    setSent(true)
    if (draftMeta && !draftMeta.learning) {
      const next = approvals + 1
      setApprovals(next)
      if (next >= 10 && !autoCats.includes(klass)) setAutoPrompt(true)
    }
  }

  return (
    <div className="flex h-full">
      {/* Pane 1 — conversation list */}
      <div className="flex w-[340px] shrink-0 flex-col border-r border-line bg-white">
        <div className="border-b border-line p-3">
          <div className="relative">
            <Search size={15} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-faint" />
            <input placeholder="Search replies…" className="h-8 w-full rounded border border-line-mid bg-white pl-8 pr-2.5 text-sm text-ink placeholder:text-faint focus-ring" />
          </div>
          <div className="mt-2 flex gap-1">
            {FILTERS.map((f) => (
              <button key={f} onClick={() => setFilter(f)} className={cx('rounded-full px-2.5 py-1 text-tiny transition-colors', filter === f ? 'bg-accent-soft font-medium text-accent' : 'text-muted hover:bg-hover')}>{f}</button>
            ))}
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {conversations.map((c) => (
            <button key={c.id} onClick={() => selectConvo(c.id)} className={cx('flex w-full gap-2.5 border-b border-line px-3 py-3 text-left transition-colors', selectedId === c.id ? 'bg-accent-soft' : 'hover:bg-hover')}>
              <Avatar name={c.name} size={32} tint={tintFor(c.name)} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-sm font-medium text-ink">{c.name}</span>
                  <span className="shrink-0 text-tiny text-muted">{c.time}</span>
                </div>
                <div className="truncate text-tiny text-muted">{c.company}</div>
                <div className="mt-0.5 truncate text-tiny text-ink">{c.snippet}</div>
                <div className="mt-1.5 flex items-center gap-1.5">
                  <Tag tone={classTone(c.classification)} dot>{c.classification}</Tag>
                  {c.unread && <span className="h-1.5 w-1.5 rounded-full bg-accent" />}
                </div>
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Pane 2 — thread */}
      <div className="flex min-w-0 flex-1 flex-col bg-page">
        <div className="flex items-center justify-between border-b border-line bg-white px-5 py-3">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold text-ink">{convo.name}</span>
              <span className="text-tiny text-muted">· {convo.company}</span>
              <Tag tone={classTone(klass)} dot>{klass}</Tag>
            </div>
            <div className="mt-0.5 flex items-center gap-2 text-tiny text-muted">
              <span>{convo.subject}</span>
              <span className="text-faint">·</span>
              <button onClick={() => setSrcTip((s) => !s)} className="relative flex items-center gap-1 text-accent hover:underline">
                <Info size={11} /> Source sender
                {srcTip && (
                  <span className="absolute left-0 top-5 z-20 w-60 rounded-md border border-line bg-white p-2.5 text-left text-tiny font-normal text-muted shadow-float">
                    This reply was received by <span className="font-medium text-ink">{sourceSender}</span>. With “Same sender continues”, your replies go back out from the same address.
                  </span>
                )}
              </button>
            </div>
          </div>
          <div className="flex items-center gap-1">
            <button onClick={() => showToast('Conversation archived')} className="flex h-8 items-center gap-1.5 rounded border border-line-mid bg-white px-2.5 text-tiny text-muted hover:bg-hover"><Archive size={14} /> Archive</button>
            <button onClick={() => showToast('Snoozed for 3 days')} className="flex h-8 items-center gap-1.5 rounded border border-line-mid bg-white px-2.5 text-tiny text-muted hover:bg-hover"><Clock size={14} /> Snooze</button>
            <button className="flex h-8 w-8 items-center justify-center rounded border border-line-mid bg-white text-muted hover:bg-hover"><MoreHorizontal size={16} /></button>
          </div>
        </div>

        {/* Messages */}
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-5">
          {convo.thread.map((m, i) => (
            <div key={i} className={cx('flex', m.dir === 'out' ? 'justify-end' : 'justify-start')}>
              <div className={cx('max-w-[78%] rounded-lg border p-3', m.dir === 'out' ? 'border-accent-soft2 bg-accent-soft' : 'border-line bg-white')}>
                <div className="mb-1 flex items-center justify-between gap-4 text-tiny text-muted">
                  <span className="font-medium text-ink">{m.dir === 'out' ? 'You' : convo.name}</span>
                  <span>{m.time}</span>
                </div>
                <p className="text-sm leading-relaxed text-ink">{m.body}</p>
                <div className="mt-1 text-tiny text-faint">{m.from}</div>
              </div>
            </div>
          ))}
          {sent && (
            <div className="flex justify-end">
              <div className="max-w-[78%] rounded-lg border border-accent-soft2 bg-accent-soft p-3">
                <div className="mb-1 flex items-center justify-between gap-4 text-tiny text-muted"><span className="font-medium text-ink">You</span><span>Just now</span></div>
                <p className="whitespace-pre-wrap text-sm leading-relaxed text-ink">{reply}</p>
                <Tag tone="success" className="mt-1.5">Sent</Tag>
              </div>
            </div>
          )}
        </div>

        {/* Composer */}
        <div className="border-t border-line bg-white p-4">
          {/* AI draft meta */}
          {draftMeta && !sent && (
            <div className="mb-2 flex flex-wrap items-center gap-2 rounded-md border border-accent-soft2 bg-accent-soft px-3 py-2 text-tiny">
              <span className="flex items-center gap-1 font-medium text-accent"><Sparkles size={12} /> Drafted from business memory</span>
              <Tag tone="info">Confidence: {draftMeta.confidence}%</Tag>
              <span className="text-muted">Approved without edits: {approvals} of 10</span>
              {draftMeta.learning && <Tag tone="warning">AI will learn from this edit</Tag>}
            </div>
          )}
          <div className="rounded-lg border border-line-mid">
            <div className="flex items-center justify-between border-b border-line bg-page px-3 py-1.5 text-tiny text-muted">
              <span>To: {lead.email} · From: {sourceSender}</span>
              <button onClick={aiDraft} className="flex items-center gap-1 rounded px-2 py-1 font-medium text-accent hover:bg-accent-soft"><Sparkles size={13} /> AI draft reply</button>
            </div>
            <textarea
              value={reply}
              onChange={(e) => { setReply(e.target.value); if (draftMeta && !draftMeta.learning) setDraftMeta({ ...draftMeta, learning: true }) }}
              rows={3}
              placeholder={`Reply to ${convo.name.split(' ')[0]}…`}
              className="w-full resize-none bg-white px-3 py-2.5 text-sm leading-relaxed text-ink placeholder:text-faint focus:outline-none"
            />
            <div className="flex items-center justify-between border-t border-line px-3 py-2">
              <div className="flex items-center gap-1">
                {[Bold, Italic, Link2, List].map((Icon, i) => (<button key={i} className="rounded p-1.5 text-muted hover:bg-hover hover:text-ink"><Icon size={15} /></button>))}
                {draftMeta && !sent && (
                  <button onClick={() => setDraftMeta({ ...draftMeta, learning: true })} className="ml-1 flex items-center gap-1 rounded px-2 py-1 text-tiny text-muted hover:bg-hover"><Pencil size={12} /> Edit draft</button>
                )}
              </div>
              <Button variant="primary" size="sm" onClick={approveSend} disabled={!reply}>
                {sent ? 'Sent ✓' : draftMeta ? 'Approve and send' : 'Send'}
              </Button>
            </div>
          </div>

          {/* Reply button label hint */}
          <div className="mt-1.5 text-tiny text-muted">Reply from <span className="font-medium text-ink">{sourceSender}</span> · routing: Same sender continues</div>
        </div>
      </div>

      {/* Pane 3 — lead context */}
      <div className="hidden w-[300px] shrink-0 flex-col overflow-y-auto border-l border-line bg-white xl:flex">
        <div className="border-b border-line p-5 text-center">
          <Avatar name={lead.name} size={56} tint={tintFor(lead.name)} />
          <div className="mt-2.5 text-sm font-semibold text-ink">{lead.name}</div>
          <div className="text-tiny text-muted">{lead.company}</div>
          <div className="mt-1 text-tiny text-muted">{lead.email}</div>
          <div className="mt-2 flex flex-wrap justify-center gap-1">{lead.tags.map((t) => <Tag key={t} tone={tagTone(t)}>{t}</Tag>)}</div>
        </div>

        {/* Source sender / routing */}
        <div className="border-b border-line p-4 text-tiny">
          <div className="flex items-center justify-between py-1"><span className="text-muted">Source sender</span><span className="font-mono text-ink">{sourceSender}</span></div>
          <div className="flex items-center justify-between py-1"><span className="text-muted">Routing mode</span><Tag tone="success" dot>Same sender</Tag></div>
          <div className="flex items-center justify-between py-1"><span className="text-muted">Campaign</span><span className="text-ink">{convo.campaign}</span></div>
        </div>

        {/* Out-of-office suggested action */}
        {klass === 'Out of office' && (
          <div className="border-b border-line p-4">
            <div className="rounded-md border border-info-bg bg-info-bg p-3">
              <div className="flex items-center gap-1.5 text-tiny font-medium text-info-text"><Sparkles size={12} /> Suggested action</div>
              <p className="mt-1 text-tiny text-ink">AI read “away until June 2”. Send a courteous reply now and move follow-up to Jun 5.</p>
              <Button size="sm" variant="secondary" icon={CalendarClock} className="mt-2" onClick={() => { setAppliedAction(true); showToast('Follow-up rescheduled to Jun 5') }}>Apply action</Button>
              {appliedAction && <div className="mt-2 flex items-center gap-1 text-tiny text-success-text"><Check size={12} /> Follow-up rescheduled to Jun 5</div>}
            </div>
          </div>
        )}

        {/* Classification selector */}
        <div className="border-b border-line p-4">
          <div className="mb-2 text-tiny font-medium text-ink">Classify reply</div>
          <div className="flex flex-wrap gap-1.5">
            {replyClasses.map((c) => (
              <button key={c.key} onClick={() => setKlass(c.key)} className={cx('flex items-center gap-1 rounded-full border px-2.5 py-1 text-tiny transition-colors', klass === c.key ? 'border-accent bg-accent-soft font-medium text-accent' : 'border-line-mid text-muted hover:bg-hover')}>
                {c.key}{autoCats.includes(c.key) && <Zap size={10} className="text-success-text" />}
              </button>
            ))}
          </div>
          {autoCats.includes(klass) && <Tag tone="success" className="mt-2"><Zap size={10} className="mr-1" />Auto mode on for {klass}</Tag>}
        </div>

        {/* Automation prompt */}
        {autoPrompt && (
          <div className="border-b border-line p-4">
            <div className="rounded-md border border-accent-soft2 bg-accent-soft p-3">
              <p className="text-tiny text-ink">You approved 10 replies in this category without edits. Enable auto-reply for <span className="font-medium">{klass}</span>?</p>
              <div className="mt-2 flex gap-2">
                <Button size="sm" variant="ghost" onClick={() => setAutoPrompt(false)}>Keep drafting</Button>
                <Button size="sm" variant="primary" onClick={() => setConfirmAuto(true)}>Enable for this category</Button>
              </div>
            </div>
          </div>
        )}

        <div className="border-b border-line p-4">
          <button className="w-full rounded border border-danger-bg bg-white px-3 py-2 text-tiny text-danger-text hover:bg-danger-bg">Stop sequence for this lead</button>
        </div>

        <div className="border-b border-line p-4">
          <div className="mb-1.5 text-tiny font-medium text-ink">Add note</div>
          <textarea rows={2} placeholder="Internal note…" className="w-full resize-none rounded border border-line-mid bg-white px-2.5 py-2 text-tiny text-ink placeholder:text-faint focus-ring" />
        </div>

        <div className="p-4">
          <button onClick={() => navigate(`/leads/${lead.id}`)} className="flex items-center gap-1.5 text-tiny text-accent hover:underline"><ExternalLink size={13} /> Open full profile</button>
        </div>
      </div>

      {confirmAuto && (
        <Modal
          title="Enable auto-reply"
          onClose={() => setConfirmAuto(false)}
          width="max-w-md"
          footer={<><Button variant="secondary" onClick={() => setConfirmAuto(false)}>Cancel</Button><Button variant="primary" onClick={() => { setAutoCats((a) => [...a, klass]); setConfirmAuto(false); setAutoPrompt(false); showToast(`Auto mode on for ${klass}`) }}>Enable auto-reply</Button></>}
        >
          <div className="flex gap-2.5 rounded-md bg-warning-bg p-3 text-sm text-warning-text">
            <Info size={16} className="mt-0.5 shrink-0" />
            <span>Only emails matching the <span className="font-medium">{klass}</span> classification will be automated. Everything else stays manual.</span>
          </div>
        </Modal>
      )}
      {toast && <Toast>{toast}</Toast>}
    </div>
  )
}
