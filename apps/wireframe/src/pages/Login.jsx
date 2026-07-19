import { Link, useNavigate } from 'react-router-dom'
import { Send } from 'lucide-react'
import { Button, Field, Input } from '../components/ui.jsx'

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
        <h2 className="text-title font-semibold leading-snug text-ink">Welcome back.</h2>
        <p className="mt-3 max-w-sm text-sm leading-relaxed text-muted">
          Pick up where you left off — your campaigns, replies, and analytics are waiting.
        </p>
        <figure className="mt-8 rounded-lg border border-accent-soft2 bg-white/70 p-4">
          <blockquote className="text-sm leading-relaxed text-ink">
            “The unified inbox alone saves me an hour a day.”
          </blockquote>
          <figcaption className="mt-2 text-tiny text-muted">— A community manager</figcaption>
        </figure>
      </div>
      <p className="text-tiny text-muted">Prototype · no real login.</p>
    </div>
  )
}

export default function Login() {
  const navigate = useNavigate()
  const submit = (e) => {
    e.preventDefault()
    navigate('/dashboard')
  }
  return (
    <div className="grid min-h-screen md:grid-cols-2">
      <AuthPanel />
      <div className="flex items-center justify-center bg-white px-6 py-12">
        <form onSubmit={submit} className="w-full max-w-sm">
          <h1 className="text-title font-semibold text-ink">Log in</h1>
          <p className="mt-1.5 text-sm text-muted">Welcome back to Business Lab.</p>

          <div className="mt-7 space-y-4">
            <Field label="Email">
              <Input type="email" placeholder="you@company.com" defaultValue="yakin@businesslab.com" />
            </Field>
            <Field label="Password">
              <Input type="password" placeholder="••••••••" defaultValue="prototype" />
            </Field>
            <div className="flex justify-end">
              <Link to="/login" className="text-tiny text-accent hover:underline">Forgot password?</Link>
            </div>
            <Button type="submit" variant="primary" className="w-full">Log in</Button>
          </div>

          <div className="my-5 flex items-center gap-3 text-tiny text-faint">
            <span className="h-px flex-1 bg-line" />
            or
            <span className="h-px flex-1 bg-line" />
          </div>

          <Button variant="secondary" className="w-full" onClick={() => navigate('/dashboard')}>
            Continue with Google
          </Button>

          <p className="mt-6 text-center text-sm text-muted">
            New here?{' '}
            <Link to="/signup" className="font-medium text-accent hover:underline">Sign up</Link>
          </p>
        </form>
      </div>
    </div>
  )
}
