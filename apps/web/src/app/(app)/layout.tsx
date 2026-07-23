"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Sidebar } from "@/components/sidebar";
import { api, getAccessToken } from "@/lib/api";

interface Me {
  userId: string;
  orgId: string;
  role: string;
}
interface Org {
  id: string;
  name: string;
  slug: string;
}

const TITLES: [string, string][] = [
  ["/leads", "Leads"],
  ["/campaigns", "Campaigns"],
  ["/segments", "Segments"],
  ["/inbox", "Inbox"],
  ["/templates", "Templates"],
  ["/analytics", "Analytics"],
  ["/settings", "Settings"],
  ["/dashboard", "Dashboard"],
];

export default function AppLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const router = useRouter();
  const pathname = usePathname();
  const [org, setOrg] = useState<Org | null>(null);
  const [me, setMe] = useState<Me | null>(null);

  useEffect(() => {
    if (!getAccessToken()) {
      router.replace("/login");
      return;
    }
    Promise.all([api<Me>("/auth/me"), api<Org>("/orgs/me")])
      .then(([meRes, orgRes]) => {
        setMe(meRes);
        setOrg(orgRes);
      })
      .catch(() => router.replace("/login"));
  }, [router]);

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
    <div className="flex h-screen overflow-hidden bg-page">
      <Sidebar orgName={org.name} />
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-12 shrink-0 items-center justify-between border-b border-line bg-white px-5">
          <h1 className="text-base font-semibold text-ink2">{title}</h1>
          <div className="flex items-center gap-3">
            <span className="rounded-full bg-accent-soft px-2 py-0.5 text-micro font-medium capitalize text-accent">
              {me.role}
            </span>
          </div>
        </header>
        <main className="min-h-0 flex-1 overflow-y-auto p-5">{children}</main>
      </div>
    </div>
  );
}
