"use client";

import { Fragment, useCallback, useEffect, useState } from "react";
import { ChevronDown, ChevronRight, Download, Printer } from "lucide-react";
import { downloadFile } from "@/lib/api";
import {
  CampaignAnalyticsRow,
  campaignReportPath,
  getCampaignAnalytics,
  getCampaignSteps,
  getOverview,
  Overview,
  pct,
  presetRange,
  Range,
  StepAnalyticsRow,
} from "@/lib/analytics";
import { LoadError, loadErrorText } from "@/components/feedback";
import { AnalyticsBreakdowns } from "@/components/analytics-breakdowns";
import { useLive } from "@/lib/realtime";

const PRESETS: { label: string; days: number | null }[] = [
  { label: "7 days", days: 7 },
  { label: "30 days", days: 30 },
  { label: "90 days", days: 90 },
  { label: "All time", days: null },
];

/** yyyy-mm-dd (local) → ISO; `end` makes it exclusive (start of next day). */
const dayToIso = (d: string, end = false) => {
  const date = new Date(`${d}T00:00:00`);
  if (end) date.setDate(date.getDate() + 1);
  return date.toISOString();
};

export default function AnalyticsPage() {
  const [ov, setOv] = useState<Overview | null>(null);
  const [rows, setRows] = useState<CampaignAnalyticsRow[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [preset, setPreset] = useState<number | null | "custom">(30);
  const [custom, setCustom] = useState({ from: "", to: "" });
  const [open, setOpen] = useState<string | null>(null);
  const [steps, setSteps] = useState<Record<string, StepAnalyticsRow[]>>({});

  const range: Range =
    preset === "custom"
      ? {
          from: custom.from ? dayToIso(custom.from) : undefined,
          to: custom.to ? dayToIso(custom.to, true) : undefined,
        }
      : presetRange(preset);
  const key = JSON.stringify(range);

  const load = useCallback(() => {
    setErr(null);
    const r = JSON.parse(key) as Range;
    Promise.all([getOverview(r), getCampaignAnalytics(r)])
      .then(([o, c]) => {
        setOv(o);
        setRows(c);
      })
      .catch((e) => setErr(loadErrorText(e)));
  }, [key]);

  useEffect(() => load(), [load]);
  useLive("campaigns", () => load());

  async function toggle(id: string) {
    if (open === id) return setOpen(null);
    setOpen(id);
    if (!steps[id]) {
      const s = await getCampaignSteps(id);
      setSteps((m) => ({ ...m, [id]: s }));
    }
  }

  if (err) return <LoadError message={err} onRetry={load} />;
  if (!ov) {
    return (
      <div className="flex h-64 items-center justify-center text-sm text-muted">
        Loading analytics…
      </div>
    );
  }

  const sent = ov.sent.total;
  const funnel = [
    { label: "Sent", value: sent },
    { label: "Opened", value: ov.engagement.opened },
    { label: "Clicked", value: ov.engagement.clicked },
    { label: "Replied", value: ov.engagement.replied },
  ];
  const cards = [
    { label: "Emails sent", value: sent.toLocaleString() },
    { label: "Open rate", value: pct(ov.engagement.opened, sent) },
    { label: "Click rate", value: pct(ov.engagement.clicked, sent) },
    { label: "Reply rate", value: pct(ov.engagement.replied, sent) },
    { label: "Unsubscribe rate", value: pct(ov.engagement.unsubscribed, sent) },
  ];
  const windowLabel =
    preset === "custom"
      ? `${custom.from || "start"} → ${custom.to || "today"}`
      : PRESETS.find((p) => p.days === preset)?.label ?? "";

  return (
    <div className="mx-auto max-w-shell space-y-5">
      {/* toolbar — hidden when printing */}
      <div className="flex flex-wrap items-center gap-2 print:hidden">
        <div className="flex overflow-hidden rounded border border-line-mid bg-surface">
          {PRESETS.map((p) => (
            <button
              key={p.label}
              onClick={() => setPreset(p.days)}
              className={`px-3 py-1.5 text-sm ${
                preset === p.days ? "bg-accent-soft font-medium text-accent" : "text-muted hover:bg-hover"
              }`}
            >
              {p.label}
            </button>
          ))}
          <button
            onClick={() => setPreset("custom")}
            className={`px-3 py-1.5 text-sm ${
              preset === "custom" ? "bg-accent-soft font-medium text-accent" : "text-muted hover:bg-hover"
            }`}
          >
            Custom
          </button>
        </div>
        {preset === "custom" && (
          <div className="flex items-center gap-1.5 text-sm">
            <input
              type="date"
              value={custom.from}
              max={custom.to || undefined}
              onChange={(e) => setCustom((c) => ({ ...c, from: e.target.value }))}
              className="rounded border border-line-mid bg-surface px-2 py-1"
              aria-label="From"
            />
            <span className="text-faint">→</span>
            <input
              type="date"
              value={custom.to}
              min={custom.from || undefined}
              onChange={(e) => setCustom((c) => ({ ...c, to: e.target.value }))}
              className="rounded border border-line-mid bg-surface px-2 py-1"
              aria-label="To"
            />
          </div>
        )}
        <div className="flex-1" />
        <button
          onClick={() => void downloadFile(campaignReportPath(range), "campaign-report.csv")}
          className="flex items-center gap-1.5 rounded border border-line-mid bg-surface px-3 py-1.5 text-sm text-ink hover:bg-hover"
        >
          <Download size={14} /> Export CSV
        </button>
        <button
          onClick={() => window.print()}
          className="flex items-center gap-1.5 rounded border border-line-mid bg-surface px-3 py-1.5 text-sm text-ink hover:bg-hover"
          title="Opens the print dialog — choose “Save as PDF”"
        >
          <Printer size={14} /> Save as PDF
        </button>
      </div>

      <p className="hidden text-sm text-muted print:block">Campaign report · {windowLabel}</p>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {cards.map((c) => (
          <div key={c.label} className="rounded-lg border border-line bg-surface p-4">
            <div className="text-tiny uppercase tracking-wide text-faint">{c.label}</div>
            <div className="mt-1 text-title font-semibold text-ink2">{c.value}</div>
          </div>
        ))}
      </div>

      <section className="rounded-lg border border-line bg-surface p-5">
        <h2 className="mb-4 text-sm font-semibold text-ink2">
          Engagement funnel <span className="font-normal text-faint">· {windowLabel}</span>
        </h2>
        {sent === 0 ? (
          <p className="text-sm text-muted">No emails sent in this period.</p>
        ) : (
          <div className="space-y-3">
            {funnel.map((f) => {
              const width = Math.max(2, Math.round((f.value / sent) * 100));
              return (
                <div key={f.label} className="flex items-center gap-3 text-sm">
                  <span className="w-20 shrink-0 text-muted">{f.label}</span>
                  <div className="h-6 flex-1 overflow-hidden rounded bg-panel">
                    <div className="h-full rounded bg-accent" style={{ width: `${width}%` }} />
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

      <section className="overflow-hidden rounded-lg border border-line bg-surface">
        <h2 className="border-b border-line px-4 py-3 text-sm font-semibold text-ink2">
          Campaigns <span className="font-normal text-faint">· click a row for per-step results</span>
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
                  <th className="px-3 py-2.5 text-right font-medium">Replied</th>
                  <th className="px-4 py-2.5 text-right font-medium">Unsub</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((c) => (
                  <Fragment key={c.id}>
                    <tr
                      onClick={() => void toggle(c.id)}
                      className="cursor-pointer border-b border-line last:border-0 hover:bg-hover"
                    >
                      <td className="px-4 py-2.5 font-medium text-ink">
                        <span className="inline-flex items-center gap-1">
                          {open === c.id ? (
                            <ChevronDown size={14} className="text-faint print:hidden" />
                          ) : (
                            <ChevronRight size={14} className="text-faint print:hidden" />
                          )}
                          {c.name}
                        </span>
                      </td>
                      <td className="px-3 py-2.5 capitalize text-muted">{c.status}</td>
                      <td className="px-3 py-2.5 text-right text-muted">{c.enrolled}</td>
                      <td className="px-3 py-2.5 text-right text-muted">{c.sent}</td>
                      <td className="px-3 py-2.5 text-right text-muted">
                        {c.opened} <span className="text-tiny text-faint">{pct(c.opened, c.sent)}</span>
                      </td>
                      <td className="px-3 py-2.5 text-right text-muted">
                        {c.clicked} <span className="text-tiny text-faint">{pct(c.clicked, c.sent)}</span>
                      </td>
                      <td className="px-3 py-2.5 text-right text-muted">
                        {c.replied} <span className="text-tiny text-faint">{pct(c.replied, c.sent)}</span>
                      </td>
                      <td className="px-4 py-2.5 text-right text-muted">{c.unsubscribed}</td>
                    </tr>
                    {open === c.id && (
                      <tr className="border-b border-line bg-panel">
                        <td colSpan={8} className="px-4 py-3">
                          {!steps[c.id] ? (
                            <p className="text-tiny text-muted">Loading steps…</p>
                          ) : steps[c.id].length === 0 ? (
                            <p className="text-tiny text-muted">This campaign has no steps.</p>
                          ) : (
                            <div className="space-y-2">
                              <p className="text-tiny text-faint">
                                Per-step results are lifetime totals for this campaign.
                              </p>
                              {steps[c.id].map((s) => (
                                <div key={s.step_order} className="rounded border border-line bg-surface p-2.5">
                                  <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                                    <span className="font-medium text-ink">
                                      Step {s.step_order + 1}
                                      <span className="ml-1.5 font-normal text-muted">
                                        {s.template_name ?? "(no template)"} ·{" "}
                                        {s.delay_hours ? `after ${s.delay_hours}h` : "immediately"}
                                      </span>
                                    </span>
                                    <span className="text-tiny text-muted">
                                      {s.sent} sent · open {pct(s.opened, s.sent)} · click{" "}
                                      {pct(s.clicked, s.sent)} · reply {pct(s.replied, s.sent)}
                                    </span>
                                  </div>
                                  {s.variants.length > 1 && (
                                    <ul className="mt-1.5 space-y-0.5 border-t border-line pt-1.5">
                                      {s.variants.map((v) => (
                                        <li key={v.index} className="flex justify-between gap-2 text-tiny">
                                          <span className="truncate text-ink">
                                            Variant {String.fromCharCode(65 + v.index)}: {v.subject}
                                          </span>
                                          <span className="shrink-0 text-muted">
                                            {v.sent} sent · open {pct(v.opened, v.sent)}
                                          </span>
                                        </li>
                                      ))}
                                    </ul>
                                  )}
                                </div>
                              ))}
                            </div>
                          )}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <AnalyticsBreakdowns range={range} />
    </div>
  );
}
