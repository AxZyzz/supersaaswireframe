import { useNavigate } from 'react-router-dom'
import { UploadCloud } from 'lucide-react'
import OnboardingShell from '../../components/OnboardingShell.jsx'
import { Button, Field, Input, Select, Card } from '../../components/ui.jsx'

export default function Workspace() {
  const navigate = useNavigate()
  return (
    <OnboardingShell step={1}>
      <Card>
        <h1 className="text-title font-semibold text-ink">Set up your workspace.</h1>
        <p className="mt-1.5 text-sm text-muted">A few details so we can tailor your outreach setup.</p>

        <div className="mt-6 space-y-4">
          <Field label="Workspace name">
            <Input defaultValue="Business Lab" />
          </Field>

          <Field label="Logo">
            <button className="flex w-full flex-col items-center gap-1.5 rounded-md border border-dashed border-line-mid bg-panel py-6 text-muted hover:bg-hover">
              <UploadCloud size={22} strokeWidth={1.6} />
              <span className="text-sm">Click to upload or drag a logo here</span>
              <span className="text-tiny text-faint">PNG or SVG, up to 2MB</span>
            </button>
          </Field>

          <div className="grid grid-cols-2 gap-4">
            <Field label="Industry">
              <Select defaultValue="Directory / Community">
                <option>Directory / Community</option>
                <option>Agency</option>
                <option>Other</option>
              </Select>
            </Field>
            <Field label="Team size">
              <Select defaultValue="2–10">
                <option>Just me</option>
                <option>2–10</option>
                <option>11–50</option>
                <option>50+</option>
              </Select>
            </Field>
          </div>

          <Field label="Your role">
            <Select defaultValue="Owner / Founder">
              <option>Owner / Founder</option>
              <option>Marketing</option>
              <option>Sales</option>
              <option>Operations</option>
            </Select>
          </Field>
        </div>

        <div className="mt-7 flex items-center justify-between">
          <button onClick={() => navigate('/onboarding/business-memory')} className="text-sm text-muted hover:text-ink">
            Skip for now
          </button>
          <Button variant="primary" onClick={() => navigate('/onboarding/business-memory')}>Continue</Button>
        </div>
      </Card>
    </OnboardingShell>
  )
}
