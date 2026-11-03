"use client";

import { useEffect, useState } from "react";
import {
  getSourceAnalytics,
  getTemplateAnalytics,
  pct,
  Range,
  SourceAnalyticsRow,
  TemplateAnalyticsRow,
} from "@/lib/analytics";

const th = "px-3 py-2.5 text-right font-medium";
const td = "px-3 py-2.5 text-right text-muted";

/** "12 · 40%" — count with its rate against the base. */
function Cell({ n, of }: { n: number; of: number }) {
  return (
    <td className={td}>
      {n.toLocaleString()} <span className="text-tiny text-faint">{pct(n, of)}</span>
    </td>
  );
}

/** Template + lead-source breakdowns for the analytics window (T8.3). */
export function AnalyticsBreakdowns({ range }: { range: Range }) {
  const [templates, setTemplates] = useState<TemplateAnalyticsRow[] | null>(null);
  const [sources, setSources] = useState<SourceAnalyticsRow[] | null>(null);
  const key = JSON.stringify(range);

  useEffect(() => {
    const r = JSON.parse(key) as Range;
    getTemplateAnalytics(r).then(setTemplates).catch(() => setTemplates([]));
    getSourceAnalytics(r).then(setSources).catch(() => setSources([]));
  }, [key]);

  return (
    <div className="grid gap-5 xl:grid-cols-2">
      <section className="overflow-hidden rounded-lg border border-line bg-surface">
        <h2 className="border-b border-line px-4 py-3 text-sm font-semibold text-ink2">
          Templates <span className="font-normal text-faint">· across every campaign using them</span>
        </h2>
        {!templates ? (
          <p className="px-4 py-6 text-sm text-muted">Loading…</p>
        ) : templates.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-muted">No template sends in this window.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line bg-panel text-left text-tiny uppercase tracking-wide text-faint">
                  <th className="px-4 py-2.5 font-medium">Template</th>
                  <th className={th}>Sent</th>
                  <th className={th}>Opened</th>
                  <th className={th}>Clicked</th>
                  <th className={th}>Replied</th>
                </tr>
              </thead>
              <tbody>
                {templates.map((t) => (
                  <tr key={t.id} className="border-b border-line last:border-0">
                    <td className="px-4 py-2.5">
                      <div className="font-medium text-ink">{t.name}</div>
                      <div className="text-tiny text-faint">
                        {t.campaigns} campaign{t.campaigns === 1 ? "" : "s"}
                      </div>
                    </td>
                    <td className={td}>{t.sent.toLocaleString()}</td>
                    <Cell n={t.opened} of={t.sent} />
                    <Cell n={t.clicked} of={t.sent} />
                    <Cell n={t.replied} of={t.sent} />
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="overflow-hidden rounded-lg border border-line bg-surface">
        <h2 className="border-b border-line px-4 py-3 text-sm font-semibold text-ink2">
          Lead sources <span className="font-normal text-faint">· which lists turn into replies</span>
        </h2>
        {!sources ? (
          <p className="px-4 py-6 text-sm text-muted">Loading…</p>
        ) : sources.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-muted">No leads yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line bg-panel text-left text-tiny uppercase tracking-wide text-faint">
                  <th className="px-4 py-2.5 font-medium">Source</th>
                  <th className={th}>Leads</th>
                  <th className={th}>Emailed</th>
                  <th className={th}>Opened</th>
                  <th className={th}>Replied</th>
                  <th className={th}>Converted</th>
                </tr>
              </thead>
              <tbody>
                {sources.map((s) => (
                  <tr key={s.source} className="border-b border-line last:border-0">
                    <td className="px-4 py-2.5 font-medium text-ink">{s.source}</td>
                    <td className={td}>{s.leads.toLocaleString()}</td>
                    <td className={td}>{s.emailed.toLocaleString()}</td>
                    <Cell n={s.opened} of={s.emailed} />
                    <Cell n={s.replied} of={s.emailed} />
                    <Cell n={s.converted} of={s.leads} />
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
