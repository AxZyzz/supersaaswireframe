"use client";

import { Inbox, Mail, Send, Users } from "lucide-react";

/** Dashboard skeleton (T1.9): stat cards wired to real queries as the
 *  lead/campaign/inbox modules land (E2, E4, E7). */
const STATS = [
  { label: "Total leads", value: "—", icon: Users, hint: "Lands with E2" },
  { label: "Active campaigns", value: "—", icon: Send, hint: "Lands with E4" },
  { label: "Emails sent", value: "—", icon: Mail, hint: "Lands with E5" },
  { label: "Reply rate", value: "—", icon: Inbox, hint: "Lands with E7" },
];

export default function DashboardPage() {
  return (
    <div className="mx-auto max-w-shell space-y-5">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {STATS.map((s) => {
          const Icon = s.icon;
          return (
            <div
              key={s.label}
              className="rounded-lg border border-line bg-white p-4"
            >
              <div className="mb-3 flex items-center justify-between">
                <span className="text-sm text-muted">{s.label}</span>
                <Icon size={16} strokeWidth={1.9} className="text-faint" />
              </div>
              <div className="text-title font-semibold text-ink2">
                {s.value}
              </div>
              <div className="mt-1 text-tiny text-faint">{s.hint}</div>
            </div>
          );
        })}
      </div>

      <div className="rounded-lg border border-line bg-white p-5">
        <h2 className="mb-1 text-section font-semibold text-ink2">
          Welcome to SuperSaaS
        </h2>
        <p className="text-sm text-muted">
          Your workspace is live. Lead management, campaigns, and the unified
          inbox arrive as the build progresses — this dashboard fills in with
          real numbers as each module ships.
        </p>
      </div>
    </div>
  );
}
