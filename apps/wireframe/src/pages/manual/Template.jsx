import { useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import {
  Bold,
  Italic,
  Link2,
  List,
  Image,
  ChevronDown,
  Save,
  Sparkles,
} from 'lucide-react'
import { ManualLayout } from '../../components/ManualStepper.jsx'
import { Button, Input, Tag, Avatar, cx } from '../../components/ui.jsx'
import { tintFor } from '../../data/mock.js'

const VARS = ['First name', 'Company', 'Title', 'Custom']

function Editor() {
  const [subject, setSubject] = useState('Quick idea for {{company}}')
  const [body, setBody] = useState(
    "Hi {{first_name}},\n\nI came across {{company}} in the directory and had a quick idea on getting more enquiries from local clients.\n\nWould you be open to a short call this week? Happy to share what's working for similar businesses.\n\nBest,\nYakin",
  )

  return (
    <div className="grid h-full grid-cols-1 lg:grid-cols-2">
      {/* Left: editor */}
      <div className="overflow-y-auto border-r border-line p-6">
        <h1 className="text-section font-semibold text-ink">Email template</h1>
        <p className="mt-1 text-sm text-muted">Write your email. Use variables to personalize each send.</p>

        <div className="mt-5 space-y-4">
          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <span className="text-sm font-medium text-ink">Subject</span>
              <button className="text-tiny text-accent hover:underline">+ Insert variable</button>
            </div>
            <Input value={subject} onChange={(e) => setSubject(e.target.value)} />
          </div>

          <div>
            <div className="mb-1.5 text-sm font-medium text-ink">Body</div>
            {/* Toolbar */}
            <div className="flex items-center gap-1 rounded-t-md border border-line-mid bg-page px-2 py-1.5">
              {[Bold, Italic, Link2, List, Image].map((Icon, i) => (
                <button key={i} className="rounded p-1.5 text-muted hover:bg-hover hover:text-ink">
                  <Icon size={15} />
                </button>
              ))}
              <span className="mx-1 h-4 w-px bg-line-mid" />
              <button className="flex items-center gap-1 rounded px-2 py-1 text-tiny text-muted hover:bg-hover">
                Insert variable <ChevronDown size={13} />
              </button>
            </div>
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={11}
              className="w-full rounded-b-md border border-t-0 border-line-mid bg-white px-3 py-2.5 text-sm leading-relaxed text-ink focus-ring"
            />
          </div>

          {/* Variable chips */}
          <div>
            <div className="mb-1.5 text-tiny text-muted">Click to insert:</div>
            <div className="flex flex-wrap gap-1.5">
              {VARS.map((v) => (
                <button
                  key={v}
                  className="rounded-full border border-line-mid bg-white px-2.5 py-1 text-tiny text-ink hover:bg-accent-soft hover:text-accent"
                >
                  {`{{${v.toLowerCase().replace(' ', '_')}}}`}
                </button>
              ))}
            </div>
          </div>

          <Button variant="secondary" icon={Save}>Save as template</Button>
        </div>
      </div>

      {/* Right: live preview */}
      <div className="overflow-y-auto bg-page p-6">
        <div className="mb-3 flex items-center justify-between">
          <span className="text-sm font-medium text-ink">Live preview</span>
          <button className="flex items-center gap-1.5 rounded border border-line-mid bg-white px-2.5 py-1 text-tiny text-ink hover:bg-hover">
            Preview as: Anita Sharma <ChevronDown size={13} className="text-faint" />
          </button>
        </div>

        <div className="mx-auto max-w-md overflow-hidden rounded-lg border border-line bg-white shadow-float">
          <div className="border-b border-line p-4">
            <div className="flex items-center gap-2.5">
              <Avatar name="Yakin Shah" size={32} tint={tintFor('Yakin Shah')} />
              <div>
                <div className="text-sm font-medium text-ink">Yakin Shah</div>
                <div className="text-tiny text-muted">outreach@businesslab.com</div>
              </div>
              <span className="ml-auto text-tiny text-faint">9:02 AM</span>
            </div>
            <div className="mt-3 text-sm font-semibold text-ink">Quick idea for Bright Dental</div>
            <div className="text-tiny text-muted">To: anita@brightdental.com</div>
          </div>
          <div className="space-y-3 p-4 text-sm leading-relaxed text-ink">
            <p>Hi Anita,</p>
            <p>I came across Bright Dental in the directory and had a quick idea on getting more enquiries from local clients.</p>
            <p>Would you be open to a short call this week? Happy to share what's working for similar businesses.</p>
            <p>Best,<br />Yakin</p>
            <p className="border-t border-line pt-3 text-tiny text-faint">
              You're receiving this because you're listed in the Business Lab directory. <span className="underline">Unsubscribe</span>.
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}

export default function Template() {
  const { pathname } = useLocation()
  const navigate = useNavigate()
  const standalone = pathname === '/templates/editor'

  if (standalone) {
    return (
      <div className="flex h-full flex-col">
        <div className="flex items-center justify-between border-b border-line bg-white px-6 py-3">
          <button onClick={() => navigate('/templates')} className="text-tiny text-accent hover:underline">
            ← Back to templates
          </button>
          <div className="flex items-center gap-2">
            <Button variant="secondary" onClick={() => navigate('/templates')}>Cancel</Button>
            <Button variant="primary" icon={Save} onClick={() => navigate('/templates')}>Save template</Button>
          </div>
        </div>
        <div className="min-h-0 flex-1"><Editor /></div>
      </div>
    )
  }

  return (
    <ManualLayout step={3} back="/campaigns/new/senders" next="/campaigns/new/sequence">
      <Editor />
    </ManualLayout>
  )
}
