import { useNavigate } from 'react-router-dom'
import { PartyPopper, Inbox } from 'lucide-react'
import { Button } from '../../components/ui.jsx'

export default function Launched() {
  const navigate = useNavigate()
  return (
    <div className="flex h-full items-center justify-center p-6">
      <div className="flex max-w-md flex-col items-center rounded-lg border border-line bg-white px-8 py-12 text-center">
        <span className="flex h-16 w-16 items-center justify-center rounded-full bg-accent-soft text-accent">
          <PartyPopper size={30} strokeWidth={1.9} />
        </span>
        <h1 className="mt-5 text-title font-semibold text-ink">Campaign launched 🎉</h1>
        <p className="mt-2 text-sm leading-relaxed text-muted">
          <span className="font-medium text-ink">Q3 Directory Outreach</span> is now sending to 320 leads.
        </p>
        <div className="mt-7 flex items-center gap-3">
          <Button variant="primary" onClick={() => navigate('/analytics')}>View campaign</Button>
          <Button variant="secondary" onClick={() => navigate('/campaigns')}>Back to campaigns</Button>
        </div>
        <p className="mt-6 flex items-center gap-1.5 text-tiny text-muted">
          <Inbox size={13} /> Replies will appear in your inbox.
        </p>
      </div>
    </div>
  )
}
