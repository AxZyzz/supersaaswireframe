"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Sidebar } from "@/components/sidebar";
import { NotificationBell } from "@/components/notification-bell";
import { CommandPalette, openCommandPalette } from "@/components/command-palette";
import { Toaster } from "@/components/feedback";
import { FeedbackButton } from "@/components/feedback-button";
import { ThemeToggle } from "@/components/theme-toggle";
import { Search } from "lucide-react";
import { api, ApiError, ensureSession } from "@/lib/api";
import { applyBrand } from "@/lib/branding";
import type { Org } from "@/lib/org";

interface Me {
  userId: string;
  orgId: string;
  role: string;
}

const TITLES: [string, string][] = [
  ["/leads", "Leads"],
  ["/campaigns", "Campaigns"],
  ["/segments", "Segments"],
  ["/inbox", "Inbox"],
  ["/templates", "Templates"],
  ["/analytics", "Analytics"],
  ["/settings", "Settings"],
  ["/help", "Help"],
  ["/operator", "Operator console"],
  ["/dashboard", "Dashboard"],
];

export default function AppLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const router = useRouter();
  const pathname = usePathname();
  const [org, setOrg] = useState<Org | null>(null);
  const [me, setMe] = useState<Me | null>(null);
  const [offline, setOffline] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    // A fresh page load has no access token in memory yet: restore it from
    // the httpOnly refresh cookie (or send the visitor to /login).
    ensureSession()
      .then((ok) => {
        if (!ok) {
          router.replace("/login");
          return null;
        }
        return Promise.all([api<Me>("/auth/me"), api<Org>("/orgs/me")]);
      })
      .then((res) => {
        if (!res) return;
        const [meRes, orgRes] = res;
        // New workspaces go through the setup wizard first (admins only —
        // they're the ones who can configure senders and branding).
        if (!orgRes.onboarded_at && meRes.role === "admin") {
          router.replace("/onboarding");
          return;
        }
        applyBrand(orgRes.brand_color);
        setMe(meRes);
        setOrg(orgRes);
      })
      .catch((e) => {
        // Only a real auth failure means "sign in again". A network error or
        // 5xx (API restarting, deploy in progress) keeps the session and
        // offers a retry instead of bouncing every open tab to /login.
        if (e instanceof ApiError && e.status === 401) router.replace("/login");
        else setOffline(true);
      });
  }, [router, attempt]);

  // Settings saves broadcast the new org so the shell re-themes in place.
  useEffect(() => {
    const onUpdate = (e: Event) => {
      const next = (e as CustomEvent<Org>).detail;
      applyBrand(next.brand_color);
      setOrg(next);
    };
    window.addEventListener("org-updated", onUpdate);
    return () => window.removeEventListener("org-updated", onUpdate);
  }, []);

  if (offline) {
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-3 bg-page text-center">
        <p className="text-sm text-ink">Can&apos;t reach the server right now.</p>
        <p className="text-tiny text-muted">You&apos;re still signed in. This usually clears in a few seconds.</p>
        <button
          onClick={() => {
            setOffline(false);
            setAttempt((a) => a + 1);
          }}
          className="rounded border border-line-mid bg-surface px-3 py-1.5 text-sm text-ink hover:bg-hover"
        >
          Try again
        </button>
      </div>
    );
  }

  if (!me || !org) {
    return (
      <div className="flex h-screen items-center justify-center bg-page text-sm text-muted">
        Loading workspace…
      </div>
    );
  }

  const title =
    TITLES.find(([prefix]) => pathname.startsWith(prefix))?.[1] ?? "Dashboard";

  return (
    <div className="flex h-screen overflow-hidden bg-page print:block print:h-auto print:overflow-visible">
      <Sidebar orgName={org.name} logo={org.logo_data} />
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-12 shrink-0 items-center justify-between border-b border-line bg-surface px-5 print:hidden">
          <h1 className="text-base font-semibold text-ink2">{title}</h1>
          <div className="flex items-center gap-3">
            <button
              onClick={openCommandPalette}
              className="hidden items-center gap-2 rounded border border-line-mid px-2.5 py-1 text-tiny text-faint hover:bg-hover sm:flex"
            >
              <Search size={13} /> Jump to…
              <kbd className="rounded border border-line bg-panel px-1 text-micro">Ctrl K</kbd>
            </button>
            <FeedbackButton />
            <ThemeToggle />
            <NotificationBell />
            <span className="rounded-full bg-accent-soft px-2 py-0.5 text-micro font-medium capitalize text-accent">
              {me.role}
            </span>
          </div>
        </header>
        <main className="min-h-0 flex-1 overflow-y-auto p-5 print:overflow-visible print:p-0">{children}</main>
      </div>
      <CommandPalette />
      <Toaster />
    </div>
  );
}
