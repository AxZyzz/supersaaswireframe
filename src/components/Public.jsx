import { Link, useNavigate } from 'react-router-dom'
import { Send } from 'lucide-react'
import { Button } from './ui.jsx'

export function PublicNav() {
  const navigate = useNavigate()
  return (
    <header className="sticky top-0 z-40 border-b border-line bg-white/90 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-6">
        <Link to="/" className="flex items-center gap-2">
          <span className="flex h-7 w-7 items-center justify-center rounded bg-accent text-white">
            <Send size={15} strokeWidth={2} />
          </span>
          <span className="text-sm font-semibold text-ink">Business Lab Outreach</span>
        </Link>
        <nav className="hidden items-center gap-6 text-sm text-muted md:flex">
          <Link to="/" className="hover:text-ink">Product</Link>
          <Link to="/pricing" className="hover:text-ink">Pricing</Link>
          <Link to="/" className="hover:text-ink">Docs</Link>
        </nav>
        <div className="flex items-center gap-2">
          <Button variant="ghost" onClick={() => navigate('/login')}>Log in</Button>
          <Button variant="primary" onClick={() => navigate('/signup')}>Start free</Button>
        </div>
      </div>
    </header>
  )
}

export function PublicFooter() {
  const cols = [
    { h: 'Product', items: ['Features', 'Pricing', 'Integrations', 'Changelog'] },
    { h: 'Company', items: ['About', 'Customers', 'Careers', 'Contact'] },
    { h: 'Legal', items: ['Privacy', 'Terms', 'DPA', 'Security'] },
  ]
  return (
    <footer className="border-t border-line bg-white">
      <div className="mx-auto grid max-w-6xl grid-cols-2 gap-8 px-6 py-12 md:grid-cols-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="flex h-7 w-7 items-center justify-center rounded bg-accent text-white">
              <Send size={15} strokeWidth={2} />
            </span>
            <span className="text-sm font-semibold text-ink">Business Lab</span>
          </div>
          <p className="mt-3 max-w-[14rem] text-sm text-muted">
            Turn your directory into a pipeline with AI-assisted outreach.
          </p>
        </div>
        {cols.map((c) => (
          <div key={c.h}>
            <div className="text-sm font-semibold text-ink">{c.h}</div>
            <ul className="mt-3 space-y-2 text-sm text-muted">
              {c.items.map((i) => (
                <li key={i}>
                  <Link to="/" className="hover:text-ink">{i}</Link>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <div className="border-t border-line">
        <div className="mx-auto max-w-6xl px-6 py-4 text-tiny text-muted">
          © 2026 Business Lab. A clickable prototype by A2B AI Technologies. No emails are sent.
        </div>
      </div>
    </footer>
  )
}
