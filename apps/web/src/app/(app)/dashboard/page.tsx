"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Circle,
  Inbox,
  Mail,
  Send,
  Sparkles,
  Upload,
  Users,
} from "lucide-react";
import {
  ACTIVITY_LABELS,
  CampaignAnalyticsRow,
  getCampaignAnalytics,
  getOverview,
  Overview,
  pct,
  timeAgo,
} from "@/lib/analytics";
import { getSetup, SetupStatus } from "@/lib/org";

const CHECKLIST: { key: keyof SetupStatus; label: string; href: string }[] = [
  { key: "knowledge", label: "Teach the AI your business", href: "/settings" },
  { key: "sender", label: "Connect a sender", href: "/settings" },
  { key: "senderVerified", label: "Verify your sender", href: "/settings" },
  { key: "leads", label: "Import your first leads", href: "/leads" },
  { key: "campaign", label: "Create a campaign", href: "/campaigns" },
];

const STATUS_STYLES: Record<string, string> = {
  draft: "bg-neut-bg text-muted",
  scheduled: "bg-warning-bg text-warning-text",
  active: "bg-success-bg text-success-text",
  paused: "bg-warning-bg text-warning-text",
  completed: "bg-accent-soft text-accent",
  archived: "bg-neut-bg text-faint",
};

export default function DashboardPage() {
  const [ov, setOv] = useState<Overview | null>(null);
  const [rows, setRows] = useState<CampaignAnalyticsRow[]>([]);
  const [setup, setSetup] = useState<SetupStatus | null>(null);

  useEffect(() => {
    void Promise.all([getOverview(), getCampaignAnalytics(), getSetup()]).then(
      ([o, r, s]) => {
        setOv(o);
        setRows(r);
        setSetup(s);
      },
    );
  }, []);

  if (!ov) {
    return (
      <div className="flex h-64 items-center justify-center text-sm text-muted">
        Loading dashboard…
      </div>
    );
  }

  const stats = [
    {
      label: "Total leads",
      value: ov.leads.total.toLocaleString(),
      sub: `+${ov.leads.new7} in the last 7 days`,
      icon: Users,
    },
    {
      label: "Active campaigns",
      value: ov.campaigns.active.toLocaleString(),
      sub: `${ov.campaigns.total} total`,
      icon: Send,
    },
    {
      label: "Emails sent",
      value: ov.sent.total.toLocaleString(),
      sub: `${ov.sent.last7} in the last 7 days`,
      icon: Mail,
    },
    {
      label: "Reply rate",
      value: pct(ov.engagement.replied, ov.sent.total),
      sub: `Open ${pct(ov.engagement.opened, ov.sent.total)} · Click ${pct(ov.engagement.clicked, ov.sent.total)}`,
      icon: Inbox,
    },
  ];

  return (
    <div className="mx-auto max-w-shell space-y-5">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {stats.map((s) => {
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
              <div className="text-title font-semibold text-ink2">{s.value}</div>
              <div className="mt-1 text-tiny text-faint">{s.sub}</div>
            </div>
          );
        })}
      </div>

      <div className="grid gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          {/* campaign status */}
          <section className="overflow-hidden rounded-lg border border-line bg-white">
            <div className="flex items-center justify-between border-b border-line px-4 py-3">
              <h2 className="text-sm font-semibold text-ink2">Campaign status</h2>
              <Link
                href="/campaigns"
                className="text-tiny text-accent hover:underline"
              >
                View all
              </Link>
            </div>
            {rows.length === 0 ? (
              <p className="px-4 py-8 text-center text-sm text-muted">
                No campaigns yet.{" "}
                <Link href="/campaigns" className="text-accent hover:underline">
                  Create your first one
                </Link>
                .
              </p>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-line text-left text-tiny text-faint">
                    <th className="px-4 py-2 font-medium">Campaign</th>
                    <th className="px-3 py-2 font-medium">Status</th>
                    <th className="px-3 py-2 text-right font-medium">Enrolled</th>
                    <th className="px-3 py-2 text-right font-medium">Sent</th>
                    <th className="px-3 py-2 text-right font-medium">Open</th>
                    <th className="px-4 py-2 text-right font-medium">Click</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.slice(0, 6).map((c) => (
                    <tr key={c.id} className="border-b border-line last:border-0">
                      <td className="px-4 py-2.5 font-medium text-ink">{c.name}</td>
                      <td className="px-3 py-2.5">
                        <span
                          className={`rounded-full px-2 py-0.5 text-tiny capitalize ${STATUS_STYLES[c.status] ?? ""}`}
                        >
                          {c.status}
                        </span>
                      </td>
                      <td className="px-3 py-2.5 text-right text-muted">{c.enrolled}</td>
                      <td className="px-3 py-2.5 text-right text-muted">{c.sent}</td>
                      <td className="px-3 py-2.5 text-right text-muted">
                        {pct(c.opened, c.sent)}
                      </td>
                      <td className="px-4 py-2.5 text-right text-muted">
                        {pct(c.clicked, c.sent)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>

          {/* recent activity */}
          <section className="rounded-lg border border-line bg-white p-4">
            <h2 className="mb-3 text-sm font-semibold text-ink2">Recent activity</h2>
            {ov.activity.length === 0 ? (
              <p className="text-sm text-muted">Nothing yet — import leads to get started.</p>
            ) : (
              <ul className="space-y-3">
                {ov.activity.map((a, i) => (
                  <li key={i} className="flex items-start gap-3">
                    <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-panel text-muted">
                      <Activity size={13} strokeWidth={1.9} />
                    </span>
                    <div className="min-w-0">
                      <p className="text-sm text-ink">
                        <span className="font-medium">{a.lead}</span>{" "}
                        {ACTIVITY_LABELS[a.type] ?? a.type.replace(/_/g, " ")}
                      </p>
                      <p className="text-tiny text-muted">{timeAgo(a.createdAt)}</p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        <div className="space-y-5">
          {/* start-here checklist — disappears once every step is done */}
          {setup && CHECKLIST.some((c) => !setup[c.key]) && (
            <section className="rounded-lg border border-line bg-white p-4">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-sm font-semibold text-ink2">Start here</h2>
                <span className="text-tiny text-faint">
                  {CHECKLIST.filter((c) => setup[c.key]).length}/{CHECKLIST.length}
                </span>
              </div>
              <ul className="space-y-2">
                {CHECKLIST.map((c) => (
                  <li key={c.key}>
                    <Link
                      href={c.href}
                      className="flex items-center gap-2 text-sm hover:underline"
                    >
                      {setup[c.key] ? (
                        <CheckCircle2 size={15} className="text-success-text" />
                      ) : (
                        <Circle size={15} className="text-faint" />
                      )}
                      <span
                        className={
                          setup[c.key] ? "text-muted line-through" : "text-ink"
                        }
                      >
                        {c.label}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {/* alerts */}
          <section className="rounded-lg border border-line bg-white p-4">
            <h2 className="mb-3 text-sm font-semibold text-ink2">Alerts</h2>
            {ov.alerts.length === 0 ? (
              <p className="text-sm text-muted">All clear.</p>
            ) : (
              <ul className="space-y-3">
                {ov.alerts.map((a, i) => (
                  <li
                    key={i}
                    className="flex items-start justify-between gap-2 border-t border-line pt-3 first:border-0 first:pt-0"
                  >
                    <div className="flex items-start gap-2">
                      <AlertTriangle size={15} className="mt-0.5 shrink-0 text-warning-text" />
                      <p className="text-sm text-ink">{a.message}</p>
                    </div>
                    <Link
                      href="/settings"
                      className="shrink-0 rounded border border-line-mid px-2 py-0.5 text-tiny text-ink hover:bg-hover"
                    >
                      Fix
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* quick actions */}
          <section className="rounded-lg border border-line bg-white p-4">
            <h2 className="mb-3 text-sm font-semibold text-ink2">Quick actions</h2>
            <div className="grid gap-2">
              {[
                { href: "/leads", label: "Import leads", icon: Upload },
                { href: "/campaigns", label: "New campaign", icon: Sparkles },
                { href: "/analytics", label: "View analytics", icon: Activity },
              ].map((q) => (
                <Link
                  key={q.label}
                  href={q.href}
                  className="flex items-center gap-2 rounded border border-line-mid px-3 py-2 text-sm text-ink hover:bg-hover"
                >
                  <q.icon size={15} className="text-faint" /> {q.label}
                </Link>
              ))}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
