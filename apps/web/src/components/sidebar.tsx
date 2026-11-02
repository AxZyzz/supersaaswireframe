"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import {
  BarChart3,
  FileText,
  Filter,
  Inbox,
  LayoutDashboard,
  LogOut,
  Send,
  Settings,
  Users,
} from "lucide-react";
import { clearTokens } from "@/lib/api";
import { unreadCount } from "@/lib/inbox";

const NAV = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/leads", label: "Leads", icon: Users },
  { href: "/segments", label: "Segments", icon: Filter },
  { href: "/campaigns", label: "Campaigns", icon: Send },
  { href: "/inbox", label: "Inbox", icon: Inbox },
  { href: "/templates", label: "Templates", icon: FileText },
  { href: "/analytics", label: "Analytics", icon: BarChart3 },
];

export function Sidebar({
  orgName,
  logo,
}: {
  orgName: string;
  logo?: string | null;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const initials = orgName
    .split(/\s+/)
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  // Unread inbox badge — polled (and refreshed on navigation) until the live
  // socket gateway (T7.2) lands.
  const [unread, setUnread] = useState(0);
  useEffect(() => {
    let live = true;
    const tick = () =>
      unreadCount()
        .then((r) => live && setUnread(r.unread))
        .catch(() => undefined);
    void tick();
    const t = setInterval(tick, 30_000);
    return () => {
      live = false;
      clearInterval(t);
    };
  }, [pathname]);

  return (
    <aside className="flex w-60 shrink-0 flex-col border-r border-line bg-sidebar">
      <div className="flex items-center gap-2 px-3 py-3">
        {logo ? (
          <Link
            href="/dashboard"
            className="flex h-7 w-7 items-center justify-center overflow-hidden rounded"
          >
            {/* eslint-disable-next-line @next/next/no-img-element -- data: URL */}
            <img src={logo} alt="" className="h-full w-full object-contain" />
          </Link>
        ) : (
          <Link
            href="/dashboard"
            className="flex h-7 w-7 items-center justify-center rounded bg-accent text-micro font-semibold text-white"
          >
            {initials || "SS"}
          </Link>
        )}
        <span className="truncate text-sm font-medium text-ink">
          {orgName}
        </span>
      </div>

      <nav className="flex-1 space-y-0.5 px-2 pt-2">
        {NAV.map((item) => {
          const active = pathname.startsWith(item.href);
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`group relative flex items-center gap-2.5 rounded px-2.5 py-1.5 text-sm transition-colors ${
                active
                  ? "bg-accent-soft font-medium text-accent"
                  : "text-muted hover:bg-hover hover:text-ink"
              }`}
            >
              {active && (
                <span className="absolute left-0 top-1/2 h-5 w-0.5 -translate-y-1/2 rounded-full bg-accent" />
              )}
              <Icon size={17} strokeWidth={1.9} className="shrink-0" />
              <span className="flex-1">{item.label}</span>
              {item.href === "/inbox" && unread > 0 && (
                <span className="rounded-full bg-accent px-1.5 text-micro font-medium text-white">
                  {unread > 99 ? "99+" : unread}
                </span>
              )}
            </Link>
          );
        })}
      </nav>

      <div className="space-y-0.5 border-t border-line px-2 py-2">
        <Link
          href="/settings"
          className="flex items-center gap-2.5 rounded px-2.5 py-1.5 text-sm text-muted hover:bg-hover hover:text-ink"
        >
          <Settings size={17} strokeWidth={1.9} />
          <span>Settings</span>
        </Link>
        <button
          onClick={() => {
            clearTokens();
            router.replace("/login");
          }}
          className="flex w-full items-center gap-2.5 rounded px-2.5 py-1.5 text-sm text-muted hover:bg-hover hover:text-ink"
        >
          <LogOut size={17} strokeWidth={1.9} />
          <span>Log out</span>
        </button>
      </div>
    </aside>
  );
}
