import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { FileText, ChevronRight, Check, ArrowRight, BookOpen } from 'lucide-react'
import { Tag, Button, Modal, Drawer, CopyButton, Toast, useToast, cx } from '../components/ui.jsx'
import { docsSidebar, quickStartSteps, docsCards } from '../data/mock2.js'

const statusTone = (s) => (s === 'Final' ? 'success' : s === 'Working' ? 'warning' : 'neutral')

export default function Docs() {
  const navigate = useNavigate()
  const [section, setSection] = useState('Overview')
  const [preview, setPreview] = useState(null)
  const [walkthrough, setWalkthrough] = useState(false)
  const [toast, showToast] = useToast()

  return (
    <div className="flex h-full">
      {/* Docs sidebar */}
      <nav className="w-64 shrink-0 overflow-y-auto border-r border-line bg-sidebar p-3">
        <div className="px-2 pb-2 text-micro font-medium uppercase tracking-wide text-faint">Documentation</div>
        {docsSidebar.map((s) => (
          <button
            key={s}
            onClick={() => setSection(s)}
            className={cx(
              'flex w-full items-center gap-2 rounded px-2.5 py-1.5 text-left text-sm transition-colors',
              section === s ? 'bg-accent-soft font-medium text-accent' : 'text-muted hover:bg-hover hover:text-ink',
            )}
          >
            {s}
          </button>
        ))}
      </nav>

      {/* Main content */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-3xl p-6">
          {section === 'Overview' ? (
            <>
              <h1 className="text-title font-semibold text-ink">Platform Documentation</h1>
              <p className="mt-1.5 text-sm text-muted">Use this guide to understand each workflow before using or reviewing the prototype.</p>

              <div className="mt-5 flex items-center gap-2">
                <Button variant="primary" icon={BookOpen} onClick={() => setWalkthrough(true)}>Start walkthrough</Button>
              </div>

              {/* Start here checklist */}
              <div className="mt-6 rounded-lg border border-line bg-white">
                <div className="border-b border-line px-4 py-3 text-sm font-semibold text-ink">Start here</div>
                <ol className="divide-y divide-line">
                  {quickStartSteps.map((s, i) => (
                    <li key={i} className="flex items-center justify-between gap-3 px-4 py-2.5">
                      <span className="flex items-center gap-3 text-sm text-ink">
                        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-accent-soft text-micro font-medium text-accent">{i + 1}</span>
                        {s.t}
                      </span>
                      <button onClick={() => navigate(s.to)} className="flex items-center gap-1 text-tiny text-accent hover:underline">
                        Go to screen <ArrowRight size={12} />
                      </button>
                    </li>
                  ))}
                </ol>
              </div>

              {/* Documentation cards */}
              <h2 className="mt-8 text-section font-semibold text-ink">Documentation created so far</h2>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                {docsCards.map((d) => (
                  <div key={d.file} className="flex flex-col rounded-lg border border-line bg-white p-4">
                    <div className="flex items-start justify-between">
                      <span className="flex h-8 w-8 items-center justify-center rounded-md bg-accent-soft text-accent"><FileText size={16} /></span>
                      <Tag tone={statusTone(d.status)}>{d.status}</Tag>
                    </div>
                    <div className="mt-3 break-all font-mono text-tiny text-ink">{d.file}</div>
                    <p className="mt-1 flex-1 text-tiny text-muted">{d.desc}</p>
                    <div className="mt-3 flex items-center gap-2">
                      <Button size="sm" variant="secondary" onClick={() => setPreview(d)}>Open</Button>
                      <CopyButton label="Copy link" onCopied={() => showToast('Link copied')} />
                    </div>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <DocSection section={section} />
          )}
        </div>
      </div>

      {/* Doc preview modal */}
      {preview && (
        <Modal title={preview.file} onClose={() => setPreview(null)} width="max-w-2xl" footer={<Button variant="secondary" onClick={() => setPreview(null)}>Close</Button>}>
          <div className="space-y-3">
            <Tag tone={statusTone(preview.status)}>{preview.status}</Tag>
            <p className="text-sm text-muted">{preview.desc}</p>
            <div className="rounded-md border border-line bg-page p-4 text-sm leading-relaxed text-ink">
              <p className="font-semibold">{preview.file}</p>
              <p className="mt-2 text-muted">This is a static in-app preview. In the real product this opens the full document. No file is downloaded in the prototype.</p>
              <div className="mt-3 space-y-1.5 text-tiny text-muted">
                <p>· Section 1 — Overview</p>
                <p>· Section 2 — Scope & workflows</p>
                <p>· Section 3 — Implementation notes</p>
              </div>
            </div>
          </div>
        </Modal>
      )}

      {/* Walkthrough drawer */}
      {walkthrough && (
        <Drawer title="Platform walkthrough" onClose={() => setWalkthrough(false)} width="max-w-sm">
          <p className="mb-3 text-sm text-muted">Eight steps to set up and run the platform. Jump to any screen.</p>
          <ol className="space-y-2">
            {quickStartSteps.map((s, i) => (
              <li key={i} className="rounded-md border border-line p-3">
                <div className="flex items-start gap-2.5">
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-accent-soft text-micro font-medium text-accent">{i + 1}</span>
                  <span className="text-sm text-ink">{s.t}</span>
                </div>
                <button onClick={() => navigate(s.to)} className="mt-2 flex items-center gap-1 pl-8 text-tiny text-accent hover:underline">
                  Go to screen <ArrowRight size={12} />
                </button>
              </li>
            ))}
          </ol>
        </Drawer>
      )}
      {toast && <Toast>{toast}</Toast>}
    </div>
  )
}

function DocSection({ section }) {
  return (
    <>
      <div className="flex items-center gap-1.5 text-tiny text-muted">
        <span>Documentation</span><ChevronRight size={12} className="text-faint" /><span className="text-ink">{section}</span>
      </div>
      <h1 className="mt-1.5 text-title font-semibold text-ink">{section}</h1>
      <p className="mt-2 text-sm leading-relaxed text-muted">
        Step-by-step guidance for <span className="font-medium text-ink">{section}</span>. This prototype page mirrors the
        real in-app help center — every section explains the workflow with screenshots and links into the product.
      </p>
      <div className="mt-5 space-y-3">
        {[1, 2, 3].map((n) => (
          <div key={n} className="rounded-lg border border-line bg-white p-4">
            <div className="flex items-center gap-2">
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-accent-soft text-micro font-medium text-accent">{n}</span>
              <span className="text-sm font-medium text-ink">Step {n}</span>
            </div>
            <p className="mt-2 text-sm leading-relaxed text-muted">
              Placeholder guidance describing how to use {section.toLowerCase()} inside the platform. Calm, practical, and
              reviewer-friendly — exactly how the live documentation will read.
            </p>
          </div>
        ))}
      </div>
    </>
  )
}
