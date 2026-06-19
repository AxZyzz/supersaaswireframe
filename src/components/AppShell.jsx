import { useEffect, useState } from 'react'
import { NavLink, Link, Outlet, useLocation, useNavigate } from 'react-router-dom'
import {
  LayoutDashboard,
  Users,
  Send,
  Inbox,
  FileText,
  BarChart3,
  Settings,
  Shield,
  Search,
  Bell,
  Plus,
  ChevronDown,
  ChevronsLeft,
  ChevronsRight,
  Star,
  Flame,
  Command,
  BookOpen,
} from 'lucide-react'
import { Avatar, cx } from './ui.jsx'
import CommandMenu from './CommandMenu.jsx'
import { workspace, user } from '../data/mock.js'

const NAV = [
  { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/leads', label: 'Leads', icon: Users },
  { to: '/campaigns', label: 'Campaigns', icon: Send },
  { to: '/inbox', label: 'Inbox', icon: Inbox, badge: '3' },
  { to: '/templates', label: 'Templates', icon: FileText },
  { to: '/analytics', label: 'Analytics', icon: BarChart3 },
]

// Per-route top-bar config: title + contextual "+ New" button
function topBarFor(pathname) {
  if (pathname.startsWith('/leads')) return { title: 'Leads', cta: { label: 'Import leads', to: '/leads/import' } }
  if (pathname.startsWith('/campaigns')) return { title: 'Campaigns', cta: { label: 'New campaign', to: '/campaigns/new' } }
  if (pathname.startsWith('/inbox')) return { title: 'Inbox', cta: null }
  if (pathname.startsWith('/templates')) return { title: 'Templates', cta: { label: 'New template', to: '/templates/editor' } }
  if (pathname.startsWith('/analytics')) return { title: 'Analytics', cta: null }
  if (pathname.startsWith('/settings')) return { title: 'Settings', cta: null }
  if (pathname.startsWith('/admin')) return { title: 'Admin', cta: null }
  if (pathname.startsWith('/docs')) return { title: 'Documentation', cta: null }
  return { title: 'Dashboard', cta: { label: 'New campaign', to: '/campaigns/new' } }
}

function SidebarLink({ item, collapsed }) {
  return (
    <NavLink
      to={item.to}
      className={({ isActive }) =>
        cx(
          'group relative flex items-center gap-2.5 rounded px-2.5 py-1.5 text-sm transition-colors',
          isActive ? 'bg-accent-soft font-medium text-accent' : 'text-muted hover:bg-hover hover:text-ink',
          collapsed && 'justify-center px-0',
        )
      }
    >
      {({ isActive }) => (
        <>
          {isActive && <span className="absolute left-0 top-1/2 h-5 w-0.5 -translate-y-1/2 rounded-full bg-accent" />}
          <item.icon size={17} strokeWidth={1.9} className="shrink-0" />
          {!collapsed && <span className="flex-1">{item.label}</span>}
          {!collapsed && item.badge && (
            <span className="rounded-full bg-accent px-1.5 text-micro font-medium text-white">{item.badge}</span>
          )}
        </>
      )}
    </NavLink>
  )
}

export default function AppShell() {
  const { pathname } = useLocation()
  const navigate = useNavigate()
  const [collapsed, setCollapsed] = useState(false)
  const [cmd, setCmd] = useState(false)
  const tb = topBarFor(pathname)

  // ⌘K / Ctrl-K opens the command menu
  useEffect(() => {
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setCmd(true)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <div className="flex h-screen overflow-hidden bg-page">
      {/* ── Sidebar ───────────────────────────────────────────────── */}
      <aside
        className={cx(
          'flex shrink-0 flex-col border-r border-line bg-sidebar transition-all',
          collapsed ? 'w-16' : 'w-60',
        )}
      >
        {/* Workspace switcher */}
        <div className="flex items-center gap-2 px-3 py-3">
          <Link to="/dashboard" className="flex h-7 w-7 items-center justify-center rounded bg-accent text-micro font-semibold text-white">
            {workspace.logoInitials}
          </Link>
          {!collapsed && (
            <button className="flex flex-1 items-center gap-1 rounded px-1 py-1 text-sm font-medium text-ink hover:bg-hover">
              <span className="truncate">{workspace.name}</span>
              <ChevronDown size={14} className="text-faint" />
            </button>
          )}
        </div>

        {/* Search field */}
        {!collapsed && (
          <div className="px-3 pb-2">
            <button
              onClick={() => setCmd(true)}
              className="flex w-full items-center gap-2 rounded border border-line-mid bg-white px-2.5 py-1.5 text-sm text-faint hover:bg-hover"
            >
              <Search size={14} />
              <span className="flex-1 text-left">Search…</span>
              <kbd className="rounded border border-line-mid px-1 text-micro">⌘K</kbd>
            </button>
          </div>
        )}
        {collapsed && (
          <div className="px-2 pb-2">
            <button onClick={() => setCmd(true)} className="flex w-full items-center justify-center rounded py-1.5 text-faint hover:bg-hover">
              <Search size={16} />
            </button>
          </div>
        )}

        {/* Primary nav */}
        <nav className="flex flex-col gap-0.5 px-2">
          {NAV.map((i) => (
            <SidebarLink key={i.to} item={i} collapsed={collapsed} />
          ))}
        </nav>

        {/* Favorites */}
        {!collapsed && (
          <div className="mt-5 px-2">
            <div className="px-2.5 pb-1 text-micro font-medium uppercase tracking-wide text-faint">Favorites</div>
            <Link to="/leads" className="flex items-center gap-2.5 rounded px-2.5 py-1.5 text-sm text-muted hover:bg-hover hover:text-ink">
              <Flame size={16} strokeWidth={1.9} className="text-danger-text" />
              Hot Leads
            </Link>
            <Link to="/campaigns" className="flex items-center gap-2.5 rounded px-2.5 py-1.5 text-sm text-muted hover:bg-hover hover:text-ink">
              <Star size={16} strokeWidth={1.9} className="text-warning-text" />
              Q3 Directory Outreach
            </Link>
          </div>
        )}

        <div className="flex-1" />

        {/* Bottom: settings, admin, user chip, collapse */}
        <div className="border-t border-line px-2 py-2">
          <SidebarLink item={{ to: '/docs', label: 'Documentation', icon: BookOpen }} collapsed={collapsed} />
          <SidebarLink item={{ to: '/settings', label: 'Settings', icon: Settings }} collapsed={collapsed} />
          <SidebarLink item={{ to: '/admin', label: 'Admin', icon: Shield }} collapsed={collapsed} />
          <Link
            to="/settings"
            className={cx('mt-1 flex items-center gap-2 rounded px-2 py-1.5 hover:bg-hover', collapsed && 'justify-center px-0')}
          >
            <span className="relative">
              <Avatar name={user.name} size={28} tint={{ bg: '#DCE3FB', text: '#3651B8' }} />
              <span className="absolute -bottom-0 -right-0 h-2 w-2 rounded-full border-2 border-sidebar bg-success-text" />
            </span>
            {!collapsed && (
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-ink">{user.name}</span>
                <span className="block truncate text-micro text-muted">{user.role}</span>
              </span>
            )}
          </Link>
          <button
            onClick={() => setCollapsed((c) => !c)}
            className={cx('mt-1 flex w-full items-center gap-2.5 rounded px-2.5 py-1.5 text-sm text-faint hover:bg-hover', collapsed && 'justify-center px-0')}
          >
            {collapsed ? <ChevronsRight size={16} /> : <ChevronsLeft size={16} />}
            {!collapsed && 'Collapse'}
          </button>
        </div>
      </aside>

      {/* ── Main column ───────────────────────────────────────────── */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Top bar */}
        <header className="flex h-[52px] shrink-0 items-center justify-between border-b border-line bg-white px-5">
          <div className="flex items-center gap-2 text-section font-semibold text-ink">{tb.title}</div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => navigate('/docs')}
              className="flex h-8 items-center gap-1.5 rounded border border-line-mid bg-white px-2.5 text-sm text-muted hover:bg-hover"
              title="Documentation"
            >
              <BookOpen size={15} /> Docs
            </button>
            <button
              onClick={() => setCmd(true)}
              className="flex h-8 items-center gap-1.5 rounded border border-line-mid bg-white px-2.5 text-sm text-muted hover:bg-hover"
            >
              <Command size={14} />
              <kbd className="text-micro text-faint">K</kbd>
            </button>
            <button className="relative flex h-8 w-8 items-center justify-center rounded text-muted hover:bg-hover">
              <Bell size={17} strokeWidth={1.9} />
              <span className="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-accent" />
            </button>
            {tb.cta && (
              <button
                onClick={() => navigate(tb.cta.to)}
                className="inline-flex h-8 items-center gap-1.5 rounded bg-accent px-3 text-sm font-medium text-white hover:bg-accent-hover"
              >
                <Plus size={15} strokeWidth={2.2} />
                {tb.cta.label}
              </button>
            )}
            <Avatar name={user.name} size={28} tint={{ bg: '#DCE3FB', text: '#3651B8' }} />
          </div>
        </header>

        {/* Routed content */}
        <main className="min-h-0 flex-1 overflow-y-auto">
          <Outlet />
        </main>
      </div>

      <CommandMenu open={cmd} onClose={() => setCmd(false)} />
    </div>
  )
}
