"use client";

import { useEffect, useState } from "react";
import {
  CampaignAnalyticsRow,
  getCampaignAnalytics,
  getOverview,
  Overview,
  pct,
} from "@/lib/analytics";

export default function AnalyticsPage() {
  const [ov, setOv] = useState<Overview | null>(null);
  const [rows, setRows] = useState<CampaignAnalyticsRow[]>([]);

  useEffect(() => {
    void Promise.all([getOverview(), getCampaignAnalytics()]).then(
      ([o, r]) => {
        setOv(o);
        setRows(r);
      },
    );
  }, []);

  if (!ov) {
    return (
      <div className="flex h-64 items-center justify-center text-sm text-muted">
        Loading analytics…
      </div>
    );
  }

  const sent = ov.sent.total;
  // Funnel: each stage as a share of emails sent. Replies stay 0 until reply
  // ingestion (E5 chunk 3) lands.
  const funnel = [
    { label: "Sent", value: sent },
    { label: "Opened", value: ov.engagement.opened },
    { label: "Clicked", value: ov.engagement.clicked },
    { label: "Replied", value: ov.engagement.replied },
  ];

  const cards = [
    { label: "Open rate", value: pct(ov.engagement.opened, sent) },
    { label: "Click rate", value: pct(ov.engagement.clicked, sent) },
    { label: "Reply rate", value: pct(ov.engagement.replied, sent) },
    { label: "Unsubscribe rate", value: pct(ov.engagement.unsubscribed, sent) },
    { label: "Bounces / failures", value: ov.engagement.bounced.toLocaleString() },
  ];

  return (
    <div className="mx-auto max-w-shell space-y-5">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {cards.map((c) => (
          <div key={c.label} className="rounded-lg border border-line bg-white p-4">
            <div className="text-tiny uppercase tracking-wide text-faint">{c.label}</div>
            <div className="mt-1 text-title font-semibold text-ink2">{c.value}</div>
          </div>
        ))}
      </div>

      <section className="rounded-lg border border-line bg-white p-5">
        <h2 className="mb-4 text-sm font-semibold text-ink2">Engagement funnel</h2>
        {sent === 0 ? (
          <p className="text-sm text-muted">
            No emails sent yet — numbers appear once a campaign starts sending.
          </p>
        ) : (
          <div className="space-y-3">
            {funnel.map((f) => {
              const width = Math.max(2, Math.round((f.value / sent) * 100));
              return (
                <div key={f.label} className="flex items-center gap-3 text-sm">
                  <span className="w-20 shrink-0 text-muted">{f.label}</span>
                  <div className="h-6 flex-1 overflow-hidden rounded bg-panel">
                    <div
                      className="h-full rounded bg-accent"
                      style={{ width: `${width}%` }}
                    />
                  </div>
                  <span className="w-24 shrink-0 text-right text-ink">
                    {f.value.toLocaleString()}{" "}
                    <span className="text-tiny text-faint">{pct(f.value, sent)}</span>
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </section>

      <section className="overflow-hidden rounded-lg border border-line bg-white">
        <h2 className="border-b border-line px-4 py-3 text-sm font-semibold text-ink2">
          Campaigns
        </h2>
        {rows.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-muted">No campaigns yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line bg-panel text-left text-tiny uppercase tracking-wide text-faint">
                  <th className="px-4 py-2.5 font-medium">Campaign</th>
                  <th className="px-3 py-2.5 font-medium">Status</th>
                  <th className="px-3 py-2.5 text-right font-medium">Enrolled</th>
                  <th className="px-3 py-2.5 text-right font-medium">Sent</th>
                  <th className="px-3 py-2.5 text-right font-medium">Opened</th>
                  <th className="px-3 py-2.5 text-right font-medium">Clicked</th>
                  <th className="px-4 py-2.5 text-right font-medium">Unsub</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((c) => (
                  <tr key={c.id} className="border-b border-line last:border-0">
                    <td className="px-4 py-2.5 font-medium text-ink">{c.name}</td>
                    <td className="px-3 py-2.5 capitalize text-muted">{c.status}</td>
                    <td className="px-3 py-2.5 text-right text-muted">{c.enrolled}</td>
                    <td className="px-3 py-2.5 text-right text-muted">{c.sent}</td>
                    <td className="px-3 py-2.5 text-right text-muted">
                      {c.opened}{" "}
                      <span className="text-tiny text-faint">{pct(c.opened, c.sent)}</span>
                    </td>
                    <td className="px-3 py-2.5 text-right text-muted">
                      {c.clicked}{" "}
                      <span className="text-tiny text-faint">{pct(c.clicked, c.sent)}</span>
                    </td>
                    <td className="px-4 py-2.5 text-right text-muted">{c.unsubscribed}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
