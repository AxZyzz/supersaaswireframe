import { useNavigate } from 'react-router-dom'
import { Check } from 'lucide-react'
import OnboardingShell from '../../components/OnboardingShell.jsx'
import { Button } from '../../components/ui.jsx'

export default function Done() {
  const navigate = useNavigate()
  return (
    <OnboardingShell step={5}>
      <div className="flex flex-col items-center rounded-lg border border-line bg-white px-8 py-14 text-center">
        <span className="flex h-16 w-16 items-center justify-center rounded-full bg-accent-soft text-accent">
          <Check size={32} strokeWidth={2.2} />
        </span>
        <h1 className="mt-5 text-title font-semibold text-ink">You're all set, Yakin.</h1>
        <p className="mt-2 max-w-sm text-sm leading-relaxed text-muted">
          Your workspace is ready. Import your first leads to get started, or jump straight to your dashboard.
        </p>
        <div className="mt-7 flex items-center gap-3">
          <Button variant="primary" onClick={() => navigate('/dashboard')}>Go to dashboard</Button>
          <Button variant="secondary" onClick={() => navigate('/dashboard')}>Import leads</Button>
        </div>
      </div>
    </OnboardingShell>
  )
}
