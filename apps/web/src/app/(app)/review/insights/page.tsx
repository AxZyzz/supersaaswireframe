"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, ChevronRight, TriangleAlert } from "lucide-react";
import { ReviewNav } from "@/components/review-nav";
import { SearchPreferenceDialog } from "@/components/search-preference-dialog";
import { canManage, useRole } from "@/lib/me";
import { errorMessage } from "@/lib/api";
import { toast } from "@/components/feedback";
import { Campaign, listCampaigns } from "@/lib/campaigns";
import { listOffers, Offer } from "@/lib/offers";
import {
  BLOCKS,
  BucketRow,
  BucketStat,
  DAYS,
  FactorEval,
  FactorView,
  getInsights,
  GridRow,
  Insight,
  InsightsResponse,
  Metric,
  METRIC_LABEL,
  pct,
  pretty,
} from "@/lib/insights";

const card = "rounded-lg border border-line bg-surface p-4";
const field =
  "rounded border border-line-mid bg-surface px-2.5 py-1.5 text-sm outline-none focus:border-accent";
const METRICS: Metric[] = ["reply", "qualified", "booked", "positive", "open"];
const RANGES = [
  { key: "30", label: "Last 30 days", days: 30 },
  { key: "90", label: "Last 90 days", days: 90 },
  { key: "all", label: "All time", days: null },
];
/** Grid cells with fewer reached companies than this are greyed and hatched. */
const MIN_CELL = 10;

export default function InsightsPage() {
  const router = useRouter();
  const manage = canManage(useRole());
  // the headline a manager wants to turn into a search preference
  const [testing, setTesting] = useState<{ insight: Insight; from?: string } | null>(null);
  /** The date filter is read when the button is clicked, not while rendering. */
  const startTest = (insight: Insight) => {
    const days = RANGES.find((r) => r.key === range)?.days;
    setTesting({
      insight,
      from: days ? new Date(Date.now() - days * 86_400_000).toISOString() : undefined,
    });
  };
  const [offers, setOffers] = useState<Offer[]>([]);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [offerId, setOfferId] = useState("");
  const [campaignId, setCampaignId] = useState("");
  const [range, setRange] = useState("all");
  // null = follow the strongest signal the data supports (until a person picks one)
  const [picked, setPicked] = useState<Metric | null>(null);
  const [data, setData] = useState<InsightsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void listOffers().then(setOffers).catch(() => setOffers([]));
    void listCampaigns().then(setCampaigns).catch(() => setCampaigns([]));
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const days = RANGES.find((r) => r.key === range)?.days;
      const res = await getInsights({
        offerId: offerId || undefined,
        campaignId: campaignId || undefined,
        from: days ? new Date(Date.now() - days * 86_400_000).toISOString() : undefined,
      });
      setData(res);
    } catch (e) {
      setError(errorMessage(e, "Couldn't load insights."));
      toast(errorMessage(e), "error");
    } finally {
      setLoading(false);
    }
  }, [offerId, campaignId, range]);

  useEffect(() => {
    void load();
  }, [load]);

  const metric: Metric = picked ?? data?.headlineMetric ?? "reply";

  return (
    <div className="mx-auto max-w-5xl space-y-5 p-4 sm:p-6">
      <header>
        <h1 className="text-xl font-semibold text-ink2">Review</h1>
        <p className="mt-1 text-sm text-muted">
          What seems to work, factor by factor. These are observations among companies we
          contacted, not decisions: always test an idea before acting on it.
        </p>
      </header>
      <ReviewNav />

      <div className={`${card} flex flex-wrap items-end gap-3`}>
        <label className="flex flex-col gap-1 text-tiny text-faint">
          Offer
          <select value={offerId} onChange={(e) => setOfferId(e.target.value)} className={field}>
            <option value="">All offers</option>
            {offers.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-tiny text-faint">
          Campaign
          <select
            value={campaignId}
            onChange={(e) => setCampaignId(e.target.value)}
            className={field}
          >
            <option value="">All campaigns</option>
            {campaigns.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-tiny text-faint">
          Sent
          <select value={range} onChange={(e) => setRange(e.target.value)} className={field}>
            {RANGES.map((r) => (
              <option key={r.key} value={r.key}>
                {r.label}
              </option>
            ))}
          </select>
        </label>
        <div className="flex flex-col gap-1 text-tiny text-faint">
          Measure
          <div role="group" aria-label="Metric" className="flex flex-wrap gap-1">
            {METRICS.map((m) => (
              <button
                key={m}
                onClick={() => setPicked(m)}
                aria-pressed={metric === m}
                className={`rounded border px-2 py-1 text-sm ${
                  metric === m
                    ? "border-accent bg-accent-soft text-accent"
                    : "border-line-mid text-ink hover:bg-hover"
                }`}
              >
                {METRIC_LABEL[m]}
              </button>
            ))}
          </div>
        </div>
      </div>

      {loading && !data && <p className="text-sm text-muted">Loading insights…</p>}
      {error && !data && <p className="text-sm text-danger-text">{error}</p>}

      {data && (
        <>
          <Summary data={data} />
          <Headlines
            data={data}
            metric={metric}
            canTest={manage}
            hasOffer={!!offerId}
            onTest={startTest}
          />
          {data.stars.warn && (
            <div
              role="alert"
              className="flex items-start gap-2 rounded-lg border border-warning-text/40 bg-warning-bg px-4 py-2 text-sm text-warning-text"
            >
              <TriangleAlert size={16} className="mt-0.5 shrink-0" />
              <span>{data.stars.message}</span>
            </div>
          )}
          {metric === "open" && (
            <p className="text-tiny text-faint">
              Opens are a diagnostic: Apple Mail and others hide real opens, so don&apos;t use them
              to decide.
            </p>
          )}
          <SendTime data={data} />
          <div className="space-y-3">
            {data.factors
              .filter((f) => f.def.group === "audience")
              .map((f) => (
                <FactorSection key={f.def.id} f={f} metric={metric} />
              ))}
          </div>
          <div className="space-y-3">
            <h2 className="text-section font-semibold text-ink2">Sending</h2>
            {data.factors
              .filter((f) => f.def.group !== "audience" && f.def.id !== "send_day" && f.def.id !== "send_hour")
              .map((f) => (
                <FactorSection key={f.def.id} f={f} metric={metric} />
              ))}
          </div>
          <p className="text-tiny text-faint">{data.note}</p>
        </>
      )}
      {testing && (
        <SearchPreferenceDialog
          insightRef={{
            offerId: offerId || undefined,
            insightId: testing.insight.id,
            campaignIds: campaignId ? [campaignId] : undefined,
            from: testing.from,
          }}
          onClose={() => setTesting(null)}
          onCreated={() => {
            setTesting(null);
            router.push("/discover");
          }}
        />
      )}
    </div>
  );
}

function Summary({ data }: { data: InsightsResponse }) {
  const t = data.totals;
  const cov = data.coverage.ratio;
  return (
    <div className={`${card} text-sm text-muted`}>
      <span className="font-medium text-ink">{t.reached}</span> companies reached
      {t.sent !== t.reached ? ` (${t.sent} contacted, ${t.bounced} bounced)` : ""} ·{" "}
      <span className="font-medium text-ink">{t.replied}</span> replied ·{" "}
      <span className="font-medium text-ink">{t.qualified}</span> confirmed qualified
      {cov !== null && ` (${pct(cov, 0)} of interested replies are confirmed)`} ·{" "}
      <span className="font-medium text-ink">{t.booked}</span> booked a call
    </div>
  );
}

function Headlines({
  data,
  metric,
  canTest,
  hasOffer,
  onTest,
}: {
  data: InsightsResponse;
  metric: Metric;
  canTest: boolean;
  /** A preference belongs to one offer, so an offer must be chosen first. */
  hasOffer: boolean;
  onTest: (i: Insight) => void;
}) {
  // opens are always a diagnostic: kept apart unless that is the metric chosen
  const all: Insight[] =
    metric === "open"
      ? data.headlinesByMetric.open
      : [...data.headlinesByMetric[metric], ...data.diagnostics];
  if (data.totals.reached === 0) {
    return (
      <div className={`${card} text-sm text-muted`}>
        No emails sent in this view yet, so there is nothing to learn from.
      </div>
    );
  }
  if (all.length === 0) {
    return (
      <div className={`${card} text-sm text-muted`}>
        <strong className="text-ink">No clear leader yet.</strong> Rates overlap or groups are
        still too small. Insights appear when a group clearly beats everyone else.
      </div>
    );
  }
  return (
    <section aria-label="Headline insights" className="space-y-2">
      <h2 className="text-section font-semibold text-ink2">What stands out</h2>
      <div className="grid gap-3 md:grid-cols-2">
        {all.map((i) => (
          <article key={i.id} className={`${card} ${i.diagnostic ? "opacity-80" : ""}`}>
            <p className="text-sm font-medium text-ink">{i.sentence}</p>
            {i.confounding && (
              <p className="mt-1 text-sm text-warning-text">{i.confounding}</p>
            )}
            <p className="mt-2 text-tiny text-faint">{i.exploratory}</p>
            {i.searchable && !i.diagnostic && canTest && (
              <button
                onClick={() => onTest(i)}
                disabled={!hasOffer}
                title={
                  hasOffer
                    ? undefined
                    : "Choose an offer above first: a search preference belongs to one offer"
                }
                className="mt-2 rounded border border-line-mid px-2.5 py-1 text-tiny text-ink hover:bg-hover disabled:cursor-not-allowed disabled:opacity-50"
              >
                Test next batch
              </button>
            )}
          </article>
        ))}
      </div>
    </section>
  );
}

function FactorSection({ f, metric }: { f: FactorView; metric: Metric }) {
  const [open, setOpen] = useState(f.def.id === "city");
  const ev = f.evals[metric];
  const unknown = f.rows.find((r) => r.bucket === "unknown");
  return (
    <section className={card}>
      <button
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 text-left"
      >
        {open ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
        <span className="text-sm font-semibold text-ink2">{f.def.label}</span>
        {!open && ev && <Verdict ev={ev} compact />}
        {!open && f.def.kind === "distribution" && (
          <span className="text-tiny text-faint">{f.rows.length} step(s) with replies</span>
        )}
        {!open && unknown && (
          <span className="text-tiny text-faint">· unknown: {unknown.reached}</span>
        )}
      </button>
      {open && (
        <div className="mt-3 space-y-3">
          {f.def.kind === "distribution" ? (
            <Distribution rows={f.rows} />
          ) : ev ? (
            <>
              <Verdict ev={ev} />
              <Bars ev={ev} />
              {f.def.funnel && <Funnel rows={f.rows} />}
            </>
          ) : null}
        </div>
      )}
    </section>
  );
}

function Verdict({ ev, compact }: { ev: FactorEval; compact?: boolean }) {
  if (ev.verdict === "leader" && ev.best) {
    return (
      <span className={`text-tiny ${compact ? "text-success-text" : "text-sm text-success-text"}`}>
        Leader: {pretty(ev.best.bucket)} ({pct(ev.best.p)})
      </span>
    );
  }
  if (ev.verdict === "no_clear_leader") {
    return (
      <span className={`${compact ? "text-tiny" : "text-sm"} text-muted`}>
        No clear leader yet. Rates overlap
        {ev.topGrey ? ` (top: ${pretty(ev.topGrey.bucket)}, ${pct(ev.topGrey.p)})` : ""}
      </span>
    );
  }
  return <span className={`${compact ? "text-tiny" : "text-sm"} text-faint`}>Not enough data yet</span>;
}

/** Bar = rate, thin line = the 95% range, n on every bar; unknown always visible. */
function Bars({ ev }: { ev: FactorEval }) {
  const all: BucketStat[] = [...ev.buckets, ...ev.thin];
  const max = Math.max(0.01, ...all.map((b) => b.hi));
  const w = (v: number) => `${Math.min(100, (v / max) * 100).toFixed(2)}%`;
  const rows = [...ev.buckets, ...ev.thin.sort((a, b) => b.n - a.n)];
  return (
    <div>
      <ul className="space-y-1.5">
        {rows.map((b) => {
          const thin = b.status === "thin";
          const tone =
            b.status === "best"
              ? "bg-success-text"
              : b.status === "worst"
                ? "bg-danger-text"
                : "bg-accent";
          return (
            <li
              key={b.bucket}
              className={`grid grid-cols-[8rem_1fr_9rem] items-center gap-2 text-sm ${thin ? "opacity-60" : ""}`}
              title={`${b.x} of ${b.n} companies, range ${pct(b.lo)} to ${pct(b.hi)}`}
            >
              <span className={`truncate ${b.bucket === "unknown" ? "text-faint" : "text-ink"}`}>
                {pretty(b.bucket)}
              </span>
              <span className="relative block h-4">
                <span
                  className={`absolute inset-y-0.5 left-0 rounded-sm ${thin ? "bg-line-faint" : tone}`}
                  style={{ width: w(b.p ?? 0) }}
                />
                <span
                  aria-hidden
                  className="absolute top-1/2 h-px bg-ink"
                  style={{ left: w(b.lo), width: `calc(${w(b.hi)} - ${w(b.lo)})` }}
                />
              </span>
              <span className="text-tiny text-muted">
                {pct(b.p)} · {b.x}/{b.n}
                {thin ? " (not enough data yet)" : ""}
                {b.status === "best" && " ★"}
              </span>
            </li>
          );
        })}
      </ul>
      <p className="mt-2 text-tiny text-faint">
        Overall {pct(ev.overall.p)} ({ev.overall.x} of {ev.overall.n}). Bar = rate, thin line =
        95% range. A group is only called best when even the cautious end beats the overall rate;
        groups under 30 companies are never judged.
      </p>
    </div>
  );
}

function Distribution({ rows }: { rows: BucketRow[] }) {
  const total = rows.reduce((n, r) => n + r.replied, 0);
  if (total === 0) return <p className="text-sm text-muted">No replies yet.</p>;
  return (
    <ul className="space-y-1 text-sm">
      {rows.map((r) => (
        <li key={r.bucket} className="flex gap-3">
          <span className="w-20 text-ink">{r.bucket}</span>
          <span className="text-muted">
            {r.replied} replying companies ({pct(r.replied / total, 0)})
          </span>
        </li>
      ))}
    </ul>
  );
}

/** discovered -> eligible -> reached -> bounced -> opened -> replied -> qualified -> booked */
function Funnel({ rows }: { rows: BucketRow[] }) {
  const sorted = [...rows].sort((a, b) => b.reached - a.reached || b.discovered - a.discovered);
  return (
    <details className="text-sm">
      <summary className="cursor-pointer text-tiny font-medium uppercase tracking-wide text-faint">
        Funnel
      </summary>
      <div className="mt-2 overflow-x-auto">
        <table className="w-full min-w-[640px] text-sm">
          <thead>
            <tr className="text-left text-tiny uppercase tracking-wide text-faint">
              {["Group", "Discovered", "Eligible", "Reached", "Bounced", "Opened", "Replied", "Qualified", "Booked"].map(
                (h) => (
                  <th key={h} className="px-2 py-1 font-normal first:pl-0">
                    {h}
                  </th>
                ),
              )}
            </tr>
          </thead>
          <tbody>
            {sorted.map((r) => (
              <tr key={r.bucket} className="border-t border-line text-muted">
                <td className={`py-1 pr-2 ${r.bucket === "unknown" ? "text-faint" : "text-ink"}`}>
                  {pretty(r.bucket)}
                </td>
                <td className="px-2">{r.discovered}</td>
                <td className="px-2">{r.eligible}</td>
                <td className="px-2">{r.reached}</td>
                <td className="px-2">{r.bounced}</td>
                <td className="px-2 text-faint">{r.opened}</td>
                <td className="px-2">{r.replied}</td>
                <td className="px-2">{r.qualified}</td>
                <td className="px-2">{r.booked}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}

/** Day x 2-hour heatmap. Cell colour = reply rate; thin cells are hatched and grey. */
function SendTime({ data }: { data: InsightsResponse }) {
  const { status, grid, overallReplyRate } = data.sendTime;
  const cells = useMemo(() => {
    const m = new Map<string, GridRow>();
    for (const g of grid) m.set(`${g.day}:${g.block}`, g);
    return m;
  }, [grid]);
  const tz = data.timezone;
  const total = tz.recipient + tz.workspace;
  const max = Math.max(0.01, ...grid.filter((g) => g.reached >= MIN_CELL).map((g) => g.replied / g.reached));
  return (
    <section className={card} aria-label="Best time to send">
      <h2 className="text-section font-semibold text-ink2">Send time</h2>
      {!status.comparable ? (
        <p className="mt-1 text-sm text-muted">{status.message}</p>
      ) : (
        <>
          <p className="mt-1 text-sm text-muted">
            Reply rate by day and time of day
            {total > 0
              ? tz.workspace === 0
                ? ", in each company's own timezone."
                : `, in each company's timezone where we know it (${total - tz.workspace} of ${total}); the other ${tz.workspace} use your workspace timezone (${tz.workspaceZone}).`
              : "."}
          </p>
          <div className="mt-3 overflow-x-auto">
            <table className="min-w-[520px] border-separate border-spacing-1 text-tiny">
              <thead>
                <tr>
                  <th />
                  {BLOCKS.map((b) => (
                    <th key={b} className="font-normal text-faint">
                      {b}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {DAYS.map((d, day) => (
                  <tr key={d}>
                    <th className="pr-1 text-left font-normal text-faint">{d}</th>
                    {BLOCKS.map((b, block) => {
                      const g = cells.get(`${day}:${block}`);
                      const thin = !g || g.reached < MIN_CELL;
                      const rate = g && g.reached > 0 ? g.replied / g.reached : null;
                      const title = g
                        ? `${d} ${b}: ${g.replied} of ${g.reached} companies replied${thin ? " (not enough data yet)" : ""}`
                        : `${d} ${b}: no emails`;
                      return (
                        <td
                          key={b}
                          title={title}
                          className="h-8 w-12 rounded text-center"
                          style={
                            thin
                              ? {
                                  background:
                                    "repeating-linear-gradient(45deg, transparent 0 4px, rgba(150,150,150,.25) 4px 5px)",
                                }
                              : {
                                  background: `rgba(62,99,221,${(0.12 + 0.75 * ((rate ?? 0) / max)).toFixed(2)})`,
                                }
                          }
                        >
                          {g && !thin ? pct(rate, 0) : ""}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-tiny text-faint">
            Overall {pct(overallReplyRate)}. Hatched cells have fewer than {MIN_CELL} companies:
            not enough data yet. Exploratory: run a send-time test before changing when you send.
          </p>
        </>
      )}
    </section>
  );
}
