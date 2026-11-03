"use client";

import { useCallback, useEffect, useState } from "react";
import { Activity, AlertTriangle, CheckCircle2, Server, XCircle } from "lucide-react";
import { api } from "@/lib/api";
import { timeAgo } from "@/lib/analytics";
import { LoadError, loadErrorText, toast } from "@/components/feedback";
import { OperatorBeta } from "@/components/operator-beta";

interface Totals {
  orgs: number;
  orgs_7d: number;
  users: number;
  active_campaigns: number;
  sent_24h: number;
  sent_7d: number;
  failed_24h: number;
  replies_7d: number;
  leads: number;
}
interface OrgRow {
  id: string;
  name: string;
  plan: string;
  created_at: string;
  onboarded_at: string | null;
  members: number;
  leads: number;
  active_campaigns: number;
  sent_7d: number;
  failed_7d: number;
  last_sent_at: string | null;
}
interface Failure {
  kind: string;
  org_name: string;
  detail: string;
  error: string | null;
  at: string;
}
interface Health {
  readiness: { status: string; checks: { db: boolean; redis: boolean } };
  queues: Record<string, Record<string, number>>;
  uptimeSeconds: number;
  node: string;
  env: string;
}

/** A2B staff console (T8.6). The API enforces operator-only access. */
export default function OperatorPage() {
  const [data, setData] = useState<{
    totals: Totals;
    daily: { day: string; sent: number; failed: number }[];
    orgs: OrgRow[];
    failures: Failure[];
    health: Health;
  } | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(() => {
    setErr(null);
    Promise.all([
      api<{ totals: Totals; daily: { day: string; sent: number; failed: number }[] }>(
        "/operator/overview",
      ),
      api<OrgRow[]>("/operator/orgs"),
      api<Failure[]>("/operator/failures"),
      api<Health>("/operator/health"),
    ])
      .then(([ov, orgs, failures, health]) =>
        setData({ ...ov, orgs, failures, health }),
      )
      .catch((e) => setErr(loadErrorText(e)));
  }, []);

  useEffect(() => load(), [load]);

  async function setPlan(id: string, plan: string) {
    await api(`/operator/orgs/${id}/plan`, {
      method: "PATCH",
      body: JSON.stringify({ plan }),
    });
    toast("Plan updated.");
    load();
  }

  if (err) return <LoadError message={err} onRetry={load} />;
  if (!data) return <p className="text-sm text-muted">Loading operator console…</p>;

  const t = data.totals;
  const peak = Math.max(1, ...data.daily.map((d) => d.sent + d.failed));
  const stats: [string, string, string][] = [
    ["Workspaces", t.orgs.toLocaleString(), `+${t.orgs_7d} this week`],
    ["Users", t.users.toLocaleString(), `${t.leads.toLocaleString()} leads stored`],
    ["Sent (7d)", t.sent_7d.toLocaleString(), `${t.sent_24h} in 24h`],
    ["Failed (24h)", t.failed_24h.toLocaleString(), `${t.replies_7d} replies this week`],
  ];

  return (
    <div className="mx-auto max-w-shell space-y-5">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {stats.map(([label, value, sub]) => (
          <div key={label} className="rounded-lg border border-line bg-surface p-4">
            <div className="text-sm text-muted">{label}</div>
            <div className="mt-2 text-title font-semibold text-ink2">{value}</div>
            <div className="mt-1 text-tiny text-faint">{sub}</div>
          </div>
        ))}
      </div>

      <div className="grid gap-5 lg:grid-cols-3">
        <section className="rounded-lg border border-line bg-surface p-4 lg:col-span-2">
          <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-ink2">
            <Activity size={15} className="text-faint" /> Sends, last 14 days
          </h2>
          <div className="flex h-32 items-end gap-1.5">
            {data.daily.map((d) => (
              <div
                key={d.day}
                className="flex flex-1 flex-col justify-end"
                title={`${d.day}: ${d.sent} sent, ${d.failed} failed`}
              >
                <div
                  className="rounded-t-sm bg-danger-text/70"
                  style={{ height: `${(d.failed / peak) * 100}%` }}
                />
                <div
                  className="bg-accent"
                  style={{ height: `${(d.sent / peak) * 100}%`, minHeight: d.sent ? 2 : 0 }}
                />
              </div>
            ))}
          </div>
          <div className="mt-1 flex justify-between text-micro text-faint">
            <span>{data.daily[0]?.day.slice(5, 10)}</span>
            <span>today</span>
          </div>
        </section>

        <section className="rounded-lg border border-line bg-surface p-4">
          <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-ink2">
            <Server size={15} className="text-faint" /> System health
          </h2>
          <ul className="space-y-1.5 text-sm">
            {(["db", "redis"] as const).map((k) => (
              <li key={k} className="flex items-center gap-2">
                {data.health.readiness.checks[k] ? (
                  <CheckCircle2 size={15} className="text-success-text" />
                ) : (
                  <XCircle size={15} className="text-danger-text" />
                )}
                <span className="text-ink">{k === "db" ? "Postgres" : "Redis"}</span>
              </li>
            ))}
          </ul>
          <div className="mt-3 space-y-1 text-tiny text-muted">
            {Object.entries(data.health.queues).map(([q, c]) => (
              <div key={q} className="flex justify-between">
                <span>{q} queue</span>
                <span>
                  {c.waiting ?? 0} waiting · {c.active ?? 0} active ·{" "}
                  <span className={c.failed ? "text-danger-text" : ""}>{c.failed ?? 0} failed</span>
                </span>
              </div>
            ))}
            <div className="flex justify-between border-t border-line pt-1">
              <span>API uptime</span>
              <span>
                {Math.floor(data.health.uptimeSeconds / 3600)}h · {data.health.node} ·{" "}
                {data.health.env}
              </span>
            </div>
          </div>
        </section>
      </div>

      <OperatorBeta />

      <section className="overflow-hidden rounded-lg border border-line bg-surface">
        <h2 className="border-b border-line px-4 py-3 text-sm font-semibold text-ink2">
          Workspaces ({data.orgs.length})
        </h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line text-left text-tiny text-faint">
                <th className="px-4 py-2 font-medium">Workspace</th>
                <th className="px-3 py-2 font-medium">Plan</th>
                <th className="px-3 py-2 text-right font-medium">Members</th>
                <th className="px-3 py-2 text-right font-medium">Leads</th>
                <th className="px-3 py-2 text-right font-medium">Active</th>
                <th className="px-3 py-2 text-right font-medium">Sent 7d</th>
                <th className="px-3 py-2 text-right font-medium">Failed 7d</th>
                <th className="px-4 py-2 font-medium">Last send</th>
              </tr>
            </thead>
            <tbody>
              {data.orgs.map((o) => (
                <tr key={o.id} className="border-b border-line last:border-0">
                  <td className="px-4 py-2">
                    <div className="font-medium text-ink">{o.name}</div>
                    <div className="text-tiny text-faint">
                      joined {timeAgo(o.created_at)}
                      {!o.onboarded_at && " · not onboarded"}
                    </div>
                  </td>
                  <td className="px-3 py-2">
                    <select
                      value={o.plan}
                      onChange={(e) => void setPlan(o.id, e.target.value)}
                      className="rounded border border-line-mid bg-surface px-1.5 py-0.5 text-tiny"
                    >
                      <option value="beta">beta</option>
                      <option value="internal">internal</option>
                    </select>
                  </td>
                  <td className="px-3 py-2 text-right text-muted">{o.members}</td>
                  <td className="px-3 py-2 text-right text-muted">{o.leads.toLocaleString()}</td>
                  <td className="px-3 py-2 text-right text-muted">{o.active_campaigns}</td>
                  <td className="px-3 py-2 text-right text-muted">{o.sent_7d}</td>
                  <td
                    className={`px-3 py-2 text-right ${o.failed_7d ? "font-medium text-danger-text" : "text-muted"}`}
                  >
                    {o.failed_7d}
                  </td>
                  <td className="px-4 py-2 text-tiny text-muted">
                    {o.last_sent_at ? timeAgo(o.last_sent_at) : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="rounded-lg border border-line bg-surface p-4">
        <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-ink2">
          <AlertTriangle size={15} className="text-faint" /> Recent failures
        </h2>
        {data.failures.length === 0 ? (
          <p className="text-sm text-muted">No failed sends or imports.</p>
        ) : (
          <ul className="divide-y divide-line">
            {data.failures.map((f, i) => (
              <li key={i} className="py-2 text-sm">
                <div className="flex justify-between gap-3">
                  <span className="text-ink">
                    <span className="mr-1.5 rounded bg-danger-bg px-1.5 py-0.5 text-micro uppercase text-danger-text">
                      {f.kind}
                    </span>
                    {f.org_name} · {f.detail}
                  </span>
                  <span className="shrink-0 text-tiny text-faint">{timeAgo(f.at)}</span>
                </div>
                {f.error && <p className="mt-0.5 truncate text-tiny text-muted">{f.error}</p>}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
