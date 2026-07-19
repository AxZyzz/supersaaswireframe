import { Link, useNavigate } from 'react-router-dom'
import { Send } from 'lucide-react'
import { Button, Field, Input, cx } from '../components/ui.jsx'

function AuthPanel() {
  return (
    <div className="hidden flex-col justify-between bg-accent-soft p-10 md:flex">
      <Link to="/" className="flex items-center gap-2">
        <span className="flex h-7 w-7 items-center justify-center rounded bg-accent text-white">
          <Send size={15} strokeWidth={2} />
        </span>
        <span className="text-sm font-semibold text-ink">Business Lab Outreach</span>
      </Link>
      <div>
        <h2 className="text-title font-semibold leading-snug text-ink">
          Turn your directory into a pipeline.
        </h2>
        <p className="mt-3 max-w-sm text-sm leading-relaxed text-muted">
          Import leads, launch AI-assisted campaigns, and manage every reply in one calm inbox.
        </p>
        <figure className="mt-8 rounded-lg border border-accent-soft2 bg-white/70 p-4">
          <blockquote className="text-sm leading-relaxed text-ink">
            “We replaced three tools with one. Setup took an afternoon and replies finally live in one place.”
          </blockquote>
          <figcaption className="mt-2 text-tiny text-muted">— A directory operator</figcaption>
        </figure>
      </div>
      <p className="text-tiny text-muted">Prototype · no account is actually created.</p>
    </div>
  )
}

export default function Signup() {
  const navigate = useNavigate()
  const submit = (e) => {
    e.preventDefault()
    navigate('/onboarding/workspace')
  }
  return (
    <div className="grid min-h-screen md:grid-cols-2">
      <AuthPanel />
      <div className="flex items-center justify-center bg-white px-6 py-12">
        <form onSubmit={submit} className="w-full max-w-sm">
          <h1 className="text-title font-semibold text-ink">Create your account</h1>
          <p className="mt-1.5 text-sm text-muted">Start your outreach workspace in minutes.</p>

          <div className="mt-7 space-y-4">
            <Field label="Full name">
              <Input placeholder="Yakin Shah" defaultValue="Yakin Shah" />
            </Field>
            <Field label="Work email">
              <Input type="email" placeholder="you@company.com" defaultValue="yakin@businesslab.com" />
            </Field>
            <Field label="Password">
              <Input type="password" placeholder="••••••••" defaultValue="prototype" />
            </Field>
            <Button type="submit" variant="primary" className="w-full">Create account</Button>
          </div>

          <div className="my-5 flex items-center gap-3 text-tiny text-faint">
            <span className="h-px flex-1 bg-line" />
            or
            <span className="h-px flex-1 bg-line" />
          </div>

          <Button variant="secondary" className="w-full" onClick={() => navigate('/onboarding/workspace')}>
            Continue with Google
          </Button>

          <p className="mt-6 text-center text-sm text-muted">
            Already have an account?{' '}
            <Link to="/login" className="font-medium text-accent hover:underline">Log in</Link>
          </p>
        </form>
      </div>
    </div>
  )
}
