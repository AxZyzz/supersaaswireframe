import { useNavigate } from 'react-router-dom'
import { Sparkles } from 'lucide-react'
import OnboardingShell from '../../components/OnboardingShell.jsx'
import AiMemoryForm from '../../components/AiMemoryForm.jsx'
import { Button, Card, Callout, Toast } from '../../components/ui.jsx'
import { useToast } from '../../components/ui.jsx'

export default function BusinessMemory() {
  const navigate = useNavigate()
  const [toast, showToast] = useToast()
  return (
    <OnboardingShell step={2}>
      <Card>
        <div className="flex items-center gap-2">
          <Sparkles size={18} className="text-accent" />
          <h1 className="text-title font-semibold text-ink">Teach the AI about your business.</h1>
        </div>
        <p className="mt-1.5 text-sm text-muted">
          The assistant uses this memory to write campaigns and replies in your voice. You can edit it anytime under Settings → AI Memory.
        </p>

        <div className="mt-4">
          <Callout tone="info" icon={Sparkles}>
            This is your <span className="font-medium">business memory</span> — the foundation for AI campaigns, reply drafts, and the future Chief of Staff rules.
          </Callout>
        </div>

        <div className="mt-5">
          <AiMemoryForm onToast={showToast} />
        </div>

        <div className="mt-7 flex items-center justify-between">
          <button onClick={() => navigate('/onboarding/sender')} className="text-sm text-muted hover:text-ink">
            Skip for now
          </button>
          <Button variant="primary" onClick={() => navigate('/onboarding/sender')}>Save and continue</Button>
        </div>
      </Card>
      {toast && <Toast>{toast}</Toast>}
    </OnboardingShell>
  )
}
