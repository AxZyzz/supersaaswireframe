"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LoopHealthStrip } from "@/components/loop-health-strip";

const TABS = [
  { href: "/review/insights", label: "Insights" },
  { href: "/review/outcomes", label: "Replies to confirm" },
  { href: "/review/playbooks", label: "Playbooks" },
];

/** Tabs shared by the Review pages (campaign Review lives on each campaign). */
export function ReviewNav() {
  const path = usePathname();
  return (
    <>
    <nav className="flex gap-1 border-b border-line" aria-label="Review">
      {TABS.map((t) => (
        <Link
          key={t.href}
          href={t.href}
          aria-current={path.startsWith(t.href) ? "page" : undefined}
          className={`-mb-px border-b-2 px-3 py-1.5 text-sm font-medium ${
            path.startsWith(t.href)
              ? "border-accent text-accent"
              : "border-transparent text-muted hover:text-ink"
          }`}
        >
          {t.label}
        </Link>
      ))}
    </nav>
    <LoopHealthStrip />
    </>
  );
}
