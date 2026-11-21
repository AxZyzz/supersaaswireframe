"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import {
  CheckCircle2,
  ExternalLink,
  Lightbulb,
  Loader2,
  Mail,
  Search,
  Sparkles,
  Target,
  XCircle,
} from "lucide-react";
import { errorMessage } from "@/lib/api";
import { toast } from "@/components/feedback";
import { canManage, useRole } from "@/lib/me";
import {
  addProspectsToLeads,
  contactable,
  getProspectRun,
  listProspectRuns,
  Prospect,
  ProspectRun,
  startProspectRun,
} from "@/lib/prospects";
import { OfferSelect } from "@/components/offer-select";
import { SearchProfilePanel } from "@/components/search-profile-panel";
import {
  emptyStateText,
  isRunStalled,
  isRunWorking,
  nextPollDelay,
} from "@/lib/prospect-run-state";

const EXAMPLES = [
  "We sell AI customer-support automation to mid-size B2B SaaS companies in Europe that run a help desk.",
  "We build Shopify stores and growth automation for D2C fashion brands in India.",
  "We offer outsourced bookkeeping to US marketing agencies with 10-50 employees.",
];

const PARTS: { key: keyof NonNullable<Prospect["score_parts"]>; label: string; max: number }[] = [
  { key: "icp", label: "Fit to target", max: 30 },
  { key: "opportunity", label: "Opportunity", max: 25 },
  { key: "timing", label: "Timing signals", max: 20 },
  { key: "commercial", label: "Commercial fit", max: 15 },
  { key: "contact", label: "Real contact", max: 10 },
];

const STATUS_TEXT: Record<Prospect["status"], string> = {
  pending: "Waiting",
  researching: "Reading website…",
  verified: "Verified",
  unverified: "Couldn't analyse",
  rejected: "Not confirmed",
  unreachable: "Website unreadable",
};

function Stars({ n }: { n: number | null }) {
  if (!n) return null;
  return (
    <span className="text-[15px] tracking-tight text-amber-500" aria-label={`${n} of 5 stars`}>
      {"★".repeat(n)}
      <span className="text-line-mid">{"★".repeat(5 - n)}</span>
    </span>
  );
}

function ProspectCard({
  p,
  selected,
  onToggle,
  canSelect,
  runStalled,
}: {
  p: Prospect;
  selected: boolean;
  onToggle: () => void;
  canSelect: boolean;
  runStalled: boolean;
}) {
  const unfinished = p.status === "pending" || p.status === "researching";
  // In a stalled run nobody will ever finish this card: no endless spinner.
  const working = unfinished && !runStalled;
  const verified = p.status === "verified";
  const pickable = canSelect && contactable(p) && !p.lead_id;
  return (
    <div
      className={`rounded-lg border bg-surface p-4 transition-colors ${
        selected ? "border-accent ring-2 ring-accent-soft2" : "border-line"
      } ${verified ? "" : "opacity-80"}`}
    >
      <div className="flex items-start gap-3">
        {pickable && (
          <input
            type="checkbox"
            checked={selected}
            onChange={onToggle}
            aria-label={`Select ${p.company_name}`}
            className="mt-1"
          />
        )}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <h3 className="text-sm font-semibold text-ink2">{p.company_name}</h3>
            <a
              href={p.website_url ?? `https://${p.domain}`}
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-0.5 text-tiny text-muted hover:text-accent"
            >
              {p.domain} <ExternalLink size={10} />
            </a>
            <Stars n={p.stars} />
            {p.fit_score !== null && (
              <span className="text-tiny font-medium text-muted">{p.fit_score}/100</span>
            )}
            {p.lead_id && (
              <span className="rounded-full bg-success-bg px-2 py-0.5 text-tiny text-success-text">
                In leads
              </span>
            )}
            {p.via_preference && (
              <span
                className="rounded-full bg-info-bg px-2 py-0.5 text-tiny text-info-text"
                title="Found through your search preference: its own website confirms it"
              >
                From preference
              </span>
            )}
          </div>
          <div className="mt-0.5 text-tiny text-faint">
            {[p.industry, p.location].filter(Boolean).join(" · ")}
          </div>
          {verified && (
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-tiny">
              <span className="rounded-full bg-panel px-2 py-0.5 text-muted">
                City:{" "}
                <span className={p.city ? "text-ink" : "text-faint"}>
                  {p.city ?? "unknown"}
                </span>
              </span>
              <span className="rounded-full bg-panel px-2 py-0.5 text-muted">
                Industry (inferred):{" "}
                <span
                  className={
                    p.industry && p.industry !== "unknown"
                      ? "text-ink"
                      : "text-faint"
                  }
                >
                  {p.industry ?? "unknown"}
                </span>
              </span>
              <span className="rounded-full bg-panel px-2 py-0.5 text-muted">
                Size (inferred):{" "}
                <span
                  className={
                    p.size_band && p.size_band !== "unknown"
                      ? "text-ink"
                      : "text-faint"
                  }
                >
                  {p.size_band ?? "unknown"}
                </span>
              </span>
              {(p.triggers ?? []).map((tr, idx) => (
                <a
                  key={idx}
                  href={tr.url}
                  target="_blank"
                  rel="noreferrer"
                  title={`“${tr.quote}” (${tr.url})`}
                  className="rounded-full border border-accent-soft2 bg-accent-soft px-2 py-0.5 font-medium text-accent hover:underline"
                >
                  ⚡ {tr.type.replace("_", " ")}
                </a>
              ))}
            </div>
          )}
        </div>
        <span
          className={`flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-tiny ${
            verified
              ? "bg-success-bg text-success-text"
              : working
                ? "bg-accent-soft text-accent"
                : "bg-neut-bg text-muted"
          }`}
        >
          {working ? (
            <Loader2 size={11} className="animate-spin" />
          ) : verified ? (
            <CheckCircle2 size={11} />
          ) : (
            <XCircle size={11} />
          )}
          {unfinished && runStalled ? "Not finished" : STATUS_TEXT[p.status]}
        </span>
      </div>

      {!verified && !working && p.error && (
        <p className="mt-2 text-tiny text-muted">{p.error}</p>
      )}
      {working && p.reason && (
        <p className="mt-2 text-tiny text-faint">Why suggested: {p.reason}</p>
      )}

      {verified && (
        <>
          {p.summary && <p className="mt-2 text-sm text-ink">{p.summary}</p>}

          {p.score_parts && (
            <div className="mt-3 grid grid-cols-5 gap-2">
              {PARTS.map((part) => {
                const v = p.score_parts?.[part.key] ?? 0;
                return (
                  <div key={part.key} title={`${part.label}: ${v}/${part.max}`}>
                    <div className="h-1.5 overflow-hidden rounded-full bg-panel">
                      <div
                        className="h-full rounded-full bg-accent"
                        style={{ width: `${(v / part.max) * 100}%` }}
                      />
                    </div>
                    <div className="mt-1 truncate text-[10px] text-faint">
                      {part.label} {v}/{part.max}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {p.evidence.length > 0 && (
            <div className="mt-3">
              <div className="mb-1 text-tiny font-semibold uppercase tracking-wide text-faint">
                Evidence from their website
              </div>
              <ul className="space-y-1.5">
                {p.evidence.map((e, i) => (
                  <li key={i} className="text-sm text-ink">
                    {e.fact}{" "}
                    <a
                      href={e.url}
                      target="_blank"
                      rel="noreferrer"
                      className="text-tiny text-accent hover:underline"
                      title={e.url}
                    >
                      source
                    </a>
                    <div className="mt-0.5 border-l-2 border-line pl-2 text-tiny italic text-muted">
                      “{e.quote}”
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {p.opportunity && (
            <div className="mt-3 rounded-md bg-accent-soft p-3">
              <div className="mb-1 flex items-center gap-1 text-tiny font-semibold text-accent">
                <Lightbulb size={12} /> Possible opportunity (hypothesis, not a fact)
              </div>
              <p className="text-sm text-ink">{p.opportunity.hypothesis}</p>
              {p.opportunity.service && (
                <p className="mt-1 text-tiny text-muted">Offer: {p.opportunity.service}</p>
              )}
              {p.opportunity.discoveryQuestion && (
                <p className="mt-1 text-tiny text-muted">
                  Ask: “{p.opportunity.discoveryQuestion}”
                </p>
              )}
            </div>
          )}

          {p.unknowns.length > 0 && (
            <div className="mt-2 text-tiny text-muted">
              <span className="font-medium">Still unknown:</span> {p.unknowns.join(" · ")}
            </div>
          )}

          <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-line pt-3">
            <Mail size={13} className="text-faint" />
            {p.emails.filter((e) => e.mx).length === 0 ? (
              <span className="text-tiny text-muted">
                No public email on their site, so it can&apos;t be added (we never guess emails)
              </span>
            ) : (
              p.emails
                .filter((e) => e.mx)
                .map((e) => (
                  <a
                    key={e.email}
                    href={e.url}
                    target="_blank"
                    rel="noreferrer"
                    title={`Found on ${e.url}`}
                    className="rounded-full border border-line px-2 py-0.5 text-tiny text-ink hover:border-accent"
                  >
                    {e.email}
                    {e.onCompanyDomain && <span className="ml-1 text-success-text">✓</span>}
                  </a>
                ))
            )}
          </div>
        </>
      )}
    </div>
  );
}

export default function DiscoverPage() {
  const role = useRole();
  const manage = canManage(role);
  const [goal, setGoal] = useState("");
  const [count, setCount] = useState(10);
  const [offerId, setOfferId] = useState("");
  const [starting, setStarting] = useState(false);
  const [runs, setRuns] = useState<ProspectRun[]>([]);
  const [runId, setRunId] = useState<string | null>(null);
  const [run, setRun] = useState<(ProspectRun & { prospects: Prospect[] }) | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [segmentName, setSegmentName] = useState("");
  const [adding, setAdding] = useState(false);
  const [onlyVerified, setOnlyVerified] = useState(false);
  const [added, setAdded] = useState<{ id: string; name: string } | null>(null);
  // Clock for the stalled-run check, refreshed whenever the run is fetched
  // (kept in state so render stays pure). 0 = not checked yet = not stalled.
  const [checkedAt, setCheckedAt] = useState(0);

  const loadRuns = useCallback(async () => {
    try {
      const r = await listProspectRuns();
      setRuns(r);
      setRunId((cur) => cur ?? r[0]?.id ?? null);
    } catch {
      /* the global toaster shows API errors */
    }
  }, []);

  useEffect(() => {
    void loadRuns(); // eslint-disable-line react-hooks/set-state-in-effect -- initial fetch
  }, [loadRuns]);

  // Poll the open search while it's working. Stops for finished or stalled
  // runs (nothing server-side would ever finish an orphaned one), gives up
  // after MAX_POLL_ERRORS failures in a row, and pauses while the tab is
  // hidden (each poll also costs a rate-limit hit on metered Redis).
  useEffect(() => {
    if (!runId) return;
    let live = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let errors = 0;
    let pausedHidden = false;
    const schedule = (delay: number | null) => {
      if (delay === null) return;
      timer = setTimeout(() => {
        if (document.hidden) pausedHidden = true;
        else void tick();
      }, delay);
    };
    const tick = async () => {
      try {
        const r = await getProspectRun(runId);
        if (!live) return;
        const now = Date.now();
        errors = 0;
        setRun(r);
        setCheckedAt(now);
        const delay = nextPollDelay(r, 0, now);
        if (delay === null) void loadRuns();
        else schedule(delay);
      } catch {
        if (!live) return;
        errors += 1;
        schedule(nextPollDelay(null, errors, Date.now()));
      }
    };
    const onVisibility = () => {
      if (!document.hidden && pausedHidden && live) {
        pausedHidden = false;
        void tick();
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    void tick();
    return () => {
      live = false;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [runId, loadRuns]);

  async function start(e: React.FormEvent) {
    e.preventDefault();
    if (goal.trim().length < 10) {
      toast("Describe what you sell and to whom (a sentence is enough).", "error");
      return;
    }
    setStarting(true);
    try {
      const r = await startProspectRun(
        goal.trim(),
        count,
        offerId || undefined,
      );
      setRun({ ...r, prospects: [] });
      setCheckedAt(Date.now());
      setRunId(r.id);
      setSelected(new Set());
      setAdded(null);
      void loadRuns();
    } catch (err) {
      toast(errorMessage(err, "Couldn't start the search."), "error");
    }
    setStarting(false);
  }

  async function addSelected() {
    setAdding(true);
    try {
      const r = await addProspectsToLeads([...selected], segmentName.trim());
      if (r.added === 0) {
        toast("None could be added: they need a public email on their site.", "error");
      } else {
        toast(`Added ${r.added} lead${r.added === 1 ? "" : "s"} to segment "${r.segment?.name}".`);
        setAdded(r.segment);
        setSelected(new Set());
        if (runId) setRun(await getProspectRun(runId));
      }
    } catch (err) {
      toast(errorMessage(err, "Couldn't add them to leads."), "error");
    }
    setAdding(false);
  }

  const working = isRunWorking(run, checkedAt);
  const stalled = !!run && isRunStalled(run, checkedAt);
  const emptyText = emptyStateText(role);

  // Every role can browse earlier searches (agents have no search form).
  const runPicker = runs.length > 1 && (
    <select
      value={runId ?? ""}
      onChange={(e) => {
        setRunId(e.target.value);
        setSelected(new Set());
        setAdded(null);
      }}
      className="ml-auto max-w-xs truncate rounded border border-line-mid bg-surface px-2 py-1 text-tiny text-muted"
      title="Earlier searches"
      aria-label="Earlier searches"
    >
      {runs.map((r) => (
        <option key={r.id} value={r.id}>
          {new Date(r.created_at).toLocaleString()} · {r.goal.slice(0, 40)}
        </option>
      ))}
    </select>
  );
  const prospects = (run?.prospects ?? []).filter(
    (p) => !onlyVerified || p.status === "verified",
  );

  return (
    <div className="space-y-5">
      <div>
        <h1 className="flex items-center gap-2 text-title font-semibold text-ink2">
          <Sparkles size={20} className="text-accent" /> Discover
        </h1>
        <p className="text-sm text-muted">
          Describe who you sell to. Expelly proposes real companies, reads each one&apos;s own
          website, keeps only what the site says (with quotes), finds public emails and rates
          the fit.
        </p>
      </div>

      {manage && (
        <form onSubmit={start} className="rounded-lg border border-line bg-surface p-4">
          <label className="mb-1 block text-sm font-medium text-ink">
            What do you sell, and to whom?
          </label>
          <textarea
            value={goal}
            onChange={(e) => setGoal(e.target.value)}
            rows={3}
            maxLength={1000}
            placeholder={EXAMPLES[0]}
            className="w-full rounded border border-line-mid bg-surface px-3 py-2 text-sm outline-none focus:border-accent focus:ring-2 focus:ring-accent-soft2"
          />
          <div className="mt-2 flex flex-wrap gap-1.5">
            {EXAMPLES.map((ex) => (
              <button
                key={ex}
                type="button"
                onClick={() => setGoal(ex)}
                className="rounded-full border border-line px-2.5 py-1 text-tiny text-muted hover:border-accent hover:text-accent"
              >
                {ex.length > 60 ? `${ex.slice(0, 60)}…` : ex}
              </button>
            ))}
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-2 text-sm text-muted">
              Offer
              <OfferSelect
                value={offerId}
                onChange={setOfferId}
                disabled={starting || !!working}
              />
            </label>
            <label className="flex items-center gap-2 text-sm text-muted">
              Companies
              <select
                value={count}
                onChange={(e) => setCount(Number(e.target.value))}
                className="rounded border border-line-mid bg-surface px-2 py-1 text-sm"
              >
                {[6, 10, 15, 20].map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="submit"
              disabled={starting || working}
              className="flex items-center gap-1.5 rounded bg-accent px-4 py-1.5 text-sm font-medium text-white hover:bg-accent-hover disabled:opacity-60"
            >
              <Search size={14} /> {starting ? "Starting…" : working ? "Searching…" : "Find prospects"}
            </button>
            {runPicker}
          </div>
        </form>
      )}

      {!manage && runPicker && <div className="flex">{runPicker}</div>}

      <SearchProfilePanel canManage={manage} refreshKey={run?.status === "done" ? 1 : 0} />

      {run && (
        <div className="rounded-lg border border-line bg-surface p-4">
          <div className="flex flex-wrap items-center gap-3">
            <Target size={16} className="text-accent" />
            <div className="min-w-0 flex-1 text-sm font-medium text-ink2">
              {run.icp?.summary ?? run.goal}
            </div>
            <div className="text-tiny text-muted">
              {stalled && "Stalled: this search stopped responding. Start a new one."}
              {!stalled && run.status === "queued" && "Queued…"}
              {!stalled &&
                run.status === "running" &&
                (run.total
                  ? `Checking websites: ${run.done}/${run.total} · ${run.verified} verified`
                  : "Building your target profile and candidate list…")}
              {run.status === "done" &&
                `${run.verified} of ${run.total} verified on their own websites`}
              {run.status === "failed" && `Failed: ${run.error ?? "try again"}`}
            </div>
          </div>
          {run.allocation_line && (
            <p className="mt-2 text-sm text-ink" data-testid="allocation-line">
              {run.allocation_line}
            </p>
          )}
          {working && (
            <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-panel">
              <div
                className="h-full rounded-full bg-accent transition-all"
                style={{
                  width: `${run.total ? Math.max(6, (run.done / run.total) * 100) : 6}%`,
                }}
              />
            </div>
          )}
          {run.icp && (
            <div className="mt-3 flex flex-wrap gap-1.5 text-tiny">
              {[
                ...(run.icp.industries ?? []),
                ...(run.icp.regions ?? []),
                run.icp.companySize,
                ...(run.icp.buyerRoles ?? []).map((r) => `→ ${r}`),
              ]
                .filter(Boolean)
                .map((t, i) => (
                  <span key={i} className="rounded-full bg-panel px-2 py-0.5 text-muted">
                    {t}
                  </span>
                ))}
            </div>
          )}
        </div>
      )}

      {run && run.prospects.length > 0 && (
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <label className="flex items-center gap-2 text-muted">
            <input
              type="checkbox"
              checked={onlyVerified}
              onChange={(e) => setOnlyVerified(e.target.checked)}
            />
            Verified only
          </label>
          {manage && (
            <button
              onClick={() =>
                setSelected(
                  new Set(run.prospects.filter((p) => contactable(p) && !p.lead_id).map((p) => p.id)),
                )
              }
              className="text-tiny text-accent hover:underline"
            >
              Select all with a real email
            </button>
          )}
          {added && (
            <span className="text-tiny text-success-text">
              Added to segment &quot;{added.name}&quot;.{" "}
              <Link href="/campaigns" className="font-medium underline">
                Create a campaign for it →
              </Link>
            </span>
          )}
        </div>
      )}

      <div className="grid gap-3 lg:grid-cols-2">
        {prospects.map((p) => (
          <ProspectCard
            key={p.id}
            p={p}
            canSelect={manage}
            runStalled={stalled}
            selected={selected.has(p.id)}
            onToggle={() =>
              setSelected((s) => {
                const n = new Set(s);
                if (n.has(p.id)) n.delete(p.id);
                else n.add(p.id);
                return n;
              })
            }
          />
        ))}
      </div>

      {!run && runs.length === 0 && emptyText && (
        <p className="py-10 text-center text-sm text-muted">{emptyText}</p>
      )}

      {selected.size > 0 && (
        <div className="sticky bottom-4 z-10 flex flex-wrap items-center gap-2 rounded-lg border border-accent-soft2 bg-surface p-3 shadow-float">
          <span className="text-sm font-medium text-ink2">{selected.size} selected</span>
          <input
            value={segmentName}
            onChange={(e) => setSegmentName(e.target.value)}
            placeholder="Segment name (optional)"
            maxLength={80}
            className="w-56 rounded border border-line-mid bg-surface px-2 py-1 text-sm"
          />
          <button
            onClick={() => void addSelected()}
            disabled={adding}
            className="rounded bg-accent px-3 py-1.5 text-sm font-medium text-white hover:bg-accent-hover disabled:opacity-60"
          >
            {adding ? "Adding…" : "Add to leads"}
          </button>
          <button onClick={() => setSelected(new Set())} className="text-sm text-muted hover:text-ink">
            Clear
          </button>
        </div>
      )}
    </div>
  );
}
