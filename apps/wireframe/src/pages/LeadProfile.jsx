import { useState } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import {
  ChevronRight,
  Plus,
  Mail,
  MoreHorizontal,
  MailOpen,
  Reply,
  UserPlus,
  Tag as TagIcon,
  StickyNote,
  CheckSquare,
} from 'lucide-react'
import { Tag, Avatar, Button, Tabs, Textarea, Drawer, Toast, useToast, cx } from '../components/ui.jsx'
import { leadById, leadStatusTone, tagTone, tintFor } from '../data/mock.js'
import { leadEvents, openCount } from '../data/mock2.js'
import { MousePointerClick, Send as SendIcon2, Download } from 'lucide-react'

const TIMELINE = [
  { icon: MailOpen, text: "Email opened — 'Quick idea for Bright Dental'", time: '2h ago' },
  { icon: Reply, text: "Replied to 'Q3 Directory Outreach'", time: '2h ago' },
  { icon: UserPlus, text: "Added to campaign 'Q3 Directory Outreach'", time: '3d ago' },
  { icon: TagIcon, text: "Tag 'Hot' added", time: '4d ago' },
  { icon: Mail, text: 'Imported from CSV (March import)', time: '5d ago' },
]

function FieldRow({ label, children }) {
  return (
    <div className="group flex items-center justify-between gap-3 rounded px-2 py-2 hover:bg-hover">
      <span className="text-tiny text-muted">{label}</span>
      <span className="text-right text-sm text-ink">{children}</span>
    </div>
  )
}

export default function LeadProfile() {
  const { id } = useParams()
  const navigate = useNavigate()
  const lead = leadById(id)
  const [tab, setTab] = useState('Timeline')
  const [evt, setEvt] = useState(null)
  const [toast, showToast] = useToast()

  return (
    <div className="mx-auto max-w-[1280px] p-6">
      {/* Breadcrumb + actions */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1.5 text-sm text-muted">
          <Link to="/leads" className="hover:text-ink">Leads</Link>
          <ChevronRight size={14} className="text-faint" />
          <span className="font-medium text-ink">{lead.name}</span>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="primary" icon={Plus} onClick={() => navigate('/campaigns/new')}>Add to campaign</Button>
          <Button variant="secondary" icon={Mail} onClick={() => navigate('/inbox')}>Send email</Button>
          <button className="flex h-9 w-9 items-center justify-center rounded border border-line-mid bg-white text-muted hover:bg-hover">
            <MoreHorizontal size={16} />
          </button>
        </div>
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-[320px_1fr]">
        {/* Left field panel */}
        <div className="space-y-4">
          <div className="rounded-lg border border-line bg-white p-5">
            <div className="flex flex-col items-center text-center">
              <Avatar name={lead.name} size={64} tint={tintFor(lead.name)} />
              <h1 className="mt-3 text-section font-semibold text-ink">{lead.name}</h1>
              <p className="text-sm text-muted">{lead.company}</p>
              <div className="mt-2"><Tag tone={leadStatusTone[lead.status]} dot>{lead.status}</Tag></div>
            </div>

            <div className="mt-5 border-t border-line pt-3">
              <FieldRow label="Email">{lead.email}</FieldRow>
              <FieldRow label="Phone">{lead.phone}</FieldRow>
              <FieldRow label="Company">{lead.company}</FieldRow>
              <FieldRow label="Title">{lead.title}</FieldRow>
              <FieldRow label="Source"><Tag tone="neutral">{lead.source}</Tag></FieldRow>
              <FieldRow label="Tags">
                <span className="flex flex-wrap justify-end gap-1">
                  {lead.tags.map((t) => (
                    <Tag key={t} tone={tagTone(t)}>{t}</Tag>
                  ))}
                  <button className="rounded-full border border-dashed border-line-mid px-2 text-micro text-muted hover:bg-hover">
                    + add tag
                  </button>
                </span>
              </FieldRow>
              <FieldRow label="Owner">Yakin Shah</FieldRow>
              <FieldRow label="Created">Jun 14, 2026</FieldRow>
              <FieldRow label="Lists / Segments">Hot Leads</FieldRow>
            </div>

            <button className="mt-4 w-full rounded border border-danger-bg bg-white px-3 py-2 text-sm text-danger-text hover:bg-danger-bg">
              Stop all sequences for this lead
            </button>
          </div>
        </div>

        {/* Right main */}
        <div className="rounded-lg border border-line bg-white">
          <div className="px-4 pt-2">
            <Tabs tabs={['Timeline', 'Events', 'Emails', 'Notes', 'Tasks']} active={tab} onChange={setTab} />
          </div>

          <div className="p-5">
            {tab === 'Timeline' && (
              <ul className="space-y-4">
                {TIMELINE.map((t, i) => (
                  <li key={i} className="flex items-start gap-3">
                    <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-panel text-muted">
                      <t.icon size={14} strokeWidth={1.9} />
                    </span>
                    <div>
                      <p className="text-sm text-ink">{t.text}</p>
                      <p className="text-tiny text-muted">{t.time}</p>
                    </div>
                  </li>
                ))}
              </ul>
            )}

            {tab === 'Events' && (
              <div>
                <div className="mb-3 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Tag tone="info">Opened {openCount} times</Tag>
                    <span className="text-tiny text-muted">Tracking: pixel · click redirect · reply parser</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button size="sm" variant="ghost" onClick={() => navigate('/analytics?lead=anita')}>View in analytics</Button>
                    <Button size="sm" variant="secondary" icon={Download} onClick={() => showToast('Events exported (CSV)')}>Export events</Button>
                  </div>
                </div>
                <ul className="relative space-y-3 border-l border-line pl-4">
                  {leadEvents.map((e, i) => (
                    <li key={i}>
                      <button onClick={() => setEvt(e)} className="-ml-[22px] flex w-full items-start gap-3 rounded-md p-2 text-left hover:bg-hover">
                        <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-panel text-muted">
                          {e.type.startsWith('Email') ? <SendIcon2 size={13} /> : e.type === 'Clicked' ? <MousePointerClick size={13} /> : <MailOpen size={13} />}
                        </span>
                        <span className="min-w-0">
                          <span className="block text-sm font-medium text-ink">{e.type}</span>
                          <span className="block text-tiny text-muted">{e.time} · {e.source}</span>
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {tab === 'Emails' && (
              <div className="space-y-2">
                {[
                  { subj: 'Quick idea for Bright Dental', snip: 'Hi Anita, I came across Bright Dental…', tag: 'Replied', tone: 'purple' },
                  { subj: 'Re: Quick idea for Bright Dental', snip: "Yes, I'd love to hear more…", tag: 'Interested', tone: 'success' },
                ].map((e) => (
                  <button
                    key={e.subj}
                    onClick={() => navigate('/inbox')}
                    className="flex w-full items-center justify-between gap-3 rounded-md border border-line p-3 text-left hover:bg-hover"
                  >
                    <div className="min-w-0">
                      <div className="text-sm font-medium text-ink">{e.subj}</div>
                      <div className="truncate text-tiny text-muted">{e.snip}</div>
                    </div>
                    <Tag tone={e.tone} dot>{e.tag}</Tag>
                  </button>
                ))}
              </div>
            )}

            {tab === 'Notes' && (
              <div className="space-y-4">
                <div>
                  <Textarea rows={3} placeholder="Add a note about this lead…" />
                  <div className="mt-2 flex justify-end">
                    <Button variant="primary" size="sm" icon={StickyNote}>Add note</Button>
                  </div>
                </div>
                <div className="space-y-3 border-t border-line pt-4">
                  {[
                    { who: 'Yakin Shah', when: '2d ago', body: 'Spoke at the directory mixer — keen on more patient bookings. Follow up after the demo.' },
                    { who: 'Yakin Shah', when: '5d ago', body: 'Imported from March CSV batch. High-intent dentist segment.' },
                  ].map((n, i) => (
                    <div key={i} className="rounded-md border border-line bg-page p-3">
                      <div className="mb-1 flex items-center gap-2">
                        <Avatar name={n.who} size={20} />
                        <span className="text-tiny font-medium text-ink">{n.who}</span>
                        <span className="text-tiny text-muted">· {n.when}</span>
                      </div>
                      <p className="text-sm text-ink">{n.body}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {tab === 'Tasks' && (
              <ul className="space-y-2">
                {[
                  { t: 'Follow up call', due: 'Due tomorrow', done: false },
                  { t: 'Send pricing one-pager', due: 'Due Fri', done: false },
                  { t: 'Add to Hot Leads segment', due: 'Done', done: true },
                ].map((task, i) => (
                  <li key={i} className="flex items-center gap-3 rounded-md border border-line p-3">
                    <CheckSquare size={16} className={cx(task.done ? 'text-success-text' : 'text-faint')} />
                    <span className={cx('text-sm', task.done ? 'text-muted line-through' : 'text-ink')}>{task.t}</span>
                    <span className="ml-auto text-tiny text-muted">{task.due}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>

      {evt && (
        <Drawer title={evt.type} onClose={() => setEvt(null)} width="max-w-sm">
          <div className="space-y-2 text-sm">
            <div className="flex items-center justify-between border-b border-line py-2"><span className="text-muted">Event</span><span className="font-medium text-ink">{evt.type}</span></div>
            <div className="flex items-center justify-between border-b border-line py-2"><span className="text-muted">Timestamp</span><span className="font-medium text-ink">{evt.time}</span></div>
            <div className="flex items-center justify-between border-b border-line py-2"><span className="text-muted">Tracking source</span><Tag tone="neutral">{evt.source}</Tag></div>
            <div className="flex items-center justify-between border-b border-line py-2"><span className="text-muted">Lead</span><span className="font-medium text-ink">{lead.name}</span></div>
            <div className="flex items-center justify-between border-b border-line py-2"><span className="text-muted">Campaign</span><span className="font-medium text-ink">Q3 Directory Outreach</span></div>
            <div className="pt-1 text-tiny text-muted">{evt.detail}</div>
          </div>
        </Drawer>
      )}
      {toast && <Toast>{toast}</Toast>}
    </div>
  )
}
