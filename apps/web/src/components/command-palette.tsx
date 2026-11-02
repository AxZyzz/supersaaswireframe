"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  BarChart3,
  BookOpen,
  CircleHelp,
  FileText,
  Filter,
  Inbox,
  LayoutDashboard,
  Search,
  Send,
  Settings,
  UserPlus,
  Users,
} from "lucide-react";
import { DOCS } from "@/lib/docs";

interface Command {
  id: string;
  label: string;
  hint: string;
  href: string;
  icon: typeof Users;
  keywords?: string;
}

const COMMANDS: Command[] = [
  { id: "p-dash", label: "Dashboard", hint: "Page", href: "/dashboard", icon: LayoutDashboard },
  { id: "p-leads", label: "Leads", hint: "Page", href: "/leads", icon: Users, keywords: "import csv contacts" },
  { id: "p-seg", label: "Segments", hint: "Page", href: "/segments", icon: Filter, keywords: "lists rules" },
  { id: "p-camp", label: "Campaigns", hint: "Page", href: "/campaigns", icon: Send, keywords: "sequence ai draft new" },
  { id: "p-inbox", label: "Inbox", hint: "Page", href: "/inbox", icon: Inbox, keywords: "replies conversations" },
  { id: "p-tpl", label: "Templates", hint: "Page", href: "/templates", icon: FileText },
  { id: "p-an", label: "Analytics", hint: "Page", href: "/analytics", icon: BarChart3, keywords: "reports stats" },
  { id: "p-set", label: "Settings", hint: "Page", href: "/settings", icon: Settings, keywords: "workspace branding senders api keys" },
  { id: "a-invite", label: "Invite a teammate", hint: "Action", href: "/settings#team", icon: UserPlus, keywords: "team member role" },
  { id: "p-help", label: "Help center", hint: "Page", href: "/help", icon: BookOpen, keywords: "docs guide" },
  ...DOCS.map((d) => ({
    id: `d-${d.slug}`,
    label: d.title,
    hint: "Help",
    href: `/help?a=${d.slug}`,
    icon: CircleHelp,
    keywords: d.summary,
  })),
];

/** Ctrl/⌘+K jump-to anything. Also opened by the header search button. */
export function CommandPalette() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      } else if (e.key === "Escape") {
        setOpen(false);
      }
    };
    const onOpen = () => setOpen(true);
    window.addEventListener("keydown", onKey);
    window.addEventListener("open-command-palette", onOpen);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("open-command-palette", onOpen);
    };
  }, []);

  useEffect(() => {
    if (open) {
      setQ("");
      setActive(0);
    }
  }, [open]);

  const results = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const list = needle
      ? COMMANDS.filter((c) =>
          `${c.label} ${c.keywords ?? ""}`.toLowerCase().includes(needle),
        )
      : COMMANDS.filter((c) => c.hint !== "Help"); // articles only on search
    return list.slice(0, 12);
  }, [q]);

  function go(c: Command | undefined) {
    if (!c) return;
    setOpen(false);
    router.push(c.href);
  }

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/20 px-4 pt-[12vh]"
      onMouseDown={() => setOpen(false)}
    >
      <div
        role="dialog"
        aria-label="Command palette"
        className="w-full max-w-lg overflow-hidden rounded-lg border border-line bg-white shadow-float"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b border-line px-3">
          <Search size={15} className="text-faint" />
          <input
            ref={input}
            autoFocus
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setActive(0);
            }}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setActive((a) => Math.min(a + 1, results.length - 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setActive((a) => Math.max(a - 1, 0));
              } else if (e.key === "Enter") {
                go(results[active]);
              }
            }}
            placeholder="Jump to a page, action or help article…"
            className="h-11 flex-1 bg-transparent text-sm outline-none"
          />
          <kbd className="rounded border border-line-mid bg-panel px-1 text-micro text-faint">Esc</kbd>
        </div>
        <ul className="max-h-80 overflow-y-auto py-1">
          {results.length === 0 && (
            <li className="px-3 py-6 text-center text-sm text-muted">No matches.</li>
          )}
          {results.map((c, i) => (
            <li key={c.id}>
              <Link
                href={c.href}
                onClick={(e) => {
                  e.preventDefault();
                  go(c);
                }}
                onMouseEnter={() => setActive(i)}
                className={`flex items-center gap-2.5 px-3 py-2 text-sm ${
                  i === active ? "bg-accent-soft text-accent" : "text-ink"
                }`}
              >
                <c.icon size={15} className={i === active ? "text-accent" : "text-faint"} />
                <span className="flex-1 truncate">{c.label}</span>
                <span className="text-micro text-faint">{c.hint}</span>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

export const openCommandPalette = () =>
  window.dispatchEvent(new Event("open-command-palette"));
