"use client";

import { useCallback, useEffect, useState } from "react";
import { Check, FlaskConical, RefreshCw, X } from "lucide-react";
import { ApiError, errorMessage } from "@/lib/api";
import { toast } from "@/components/feedback";
import { ReviewActions } from "@/components/review-actions";
import {
  ArmCounts,
  ArmReport,
  FACTOR_LABEL,
  getCampaignReview,
  listScenarios,
  pct,
  prettyValue,
  refreshCampaignReview,
  Review,
  Scenario,
  signedPts,
  simulateReview,
  STATUS_LABEL,
  statusOf,
  StatusKey,
} from "@/lib/review";

const PILL: Record<StatusKey, string> = {
  collecting: "bg-neut-bg text-muted",
  ready: "bg-info-bg text-info-text",
  inconclusive: "bg-warning-bg text-warning-text",
  winner: "bg-success-bg text-success-text",
  guardrail: "bg-danger-bg text-danger-text",
};

const card = "rounded-lg border border-line bg-surface p-4";
const h3 = "mb-2 text-sm font-semibold text-ink2";

/** Every number gets a source: where it comes from and which revision. */
const source = (r: Review, n: number, what = "companies") =>
  r.simulated
    ? `Simulated data: ${n} ${what} (not your results)`
    : `From ${n} ${what} in experiment ${r.experimentId?.slice(0, 8)}, revision ${r.revision}`;

function Num({
  r,
  n,
  children,
  grey,
}: {
  r: Review;
  n: number;
  children: React.ReactNode;
  grey?: boolean;
}) {
  return (
    <span
      title={grey ? `Diagnostic: opens are unreliable. ${source(r, n)}` : source(r, n)}
      className={`cursor-help border-b border-dotted border-line-faint ${grey ? "text-faint" : ""}`}
    >
      {children}
    </span>
  );
}

/** Review tab of a campaign: the results, and (for managers) the actions on them. */
export function ReviewPanel({
  campaignId,
  canManage,
  templateId = null,
  onChanged,
}: {
  campaignId: string;
  canManage: boolean;
  /** The first step's email: used to preview a challenger. */
  templateId?: string | null;
  /** After an action changed the test (pause, resume, new challenger). */
  onChanged?: () => void;
}) {
  const [real, setReal] = useState<Review | null>(null);
  const [sim, setSim] = useState<Review | null>(null);
  const [noTest, setNoTest] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  // finding ids to highlight while a point of the explanation is hovered (T09)
  const [hot, setHot] = useState<string[]>([]);
  const [scenarios, setScenarios] = useState<Scenario[]>([]);

  const load = useCallback(async () => {
    try {
      setReal(await getCampaignReview(campaignId));
      setNoTest(false);
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) {
        setReal(null);
        setNoTest(true);
      } else {
        toast(errorMessage(e), "error");
      }
    } finally {
      setLoading(false);
    }
  }, [campaignId]);

  useEffect(() => {
    void load();
    void listScenarios()
      .then(setScenarios)
      .catch(() => setScenarios([]));
  }, [load]);

  async function refresh() {
    setBusy(true);
    try {
      const r = await refreshCampaignReview(campaignId);
      setReal(r);
      toast(r.changed ? `New revision ${r.revision} saved.` : "No new results since the last revision.", "success");
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setBusy(false);
    }
  }

  async function runSim(id: string) {
    if (!id) return;
    setBusy(true);
    try {
      setSim(await simulateReview(id));
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setBusy(false);
    }
  }

  const current = sim ?? real;

  const simulationPicker = (
    <label className="flex items-center gap-1.5 text-tiny text-faint">
      <FlaskConical size={14} />
      <select
        aria-label="Try simulation"
        value=""
        disabled={busy || scenarios.length === 0}
        onChange={(e) => void runSim(e.target.value)}
        className="rounded border border-line-mid bg-surface px-2 py-1 text-sm text-ink outline-none focus:border-accent"
      >
        <option value="">Try simulation…</option>
        {scenarios.map((s) => (
          <option key={s.id} value={s.id}>
            {s.label}
          </option>
        ))}
      </select>
    </label>
  );

  if (loading) return <p className="text-sm text-muted">Loading review…</p>;

  if (!current) {
    return (
      <div className="space-y-3">
        <div className="flex justify-end">{simulationPicker}</div>
        <div className="rounded-lg border border-dashed border-line-mid bg-surface p-8 text-center">
          <p className="text-sm font-medium text-ink">
            {noTest ? "No A/B or send-time test to review yet." : "Nothing to show yet."}
          </p>
          <p className="mt-1 text-sm text-muted">
            Start a company-level A/B test or a send-time test on step 1 in Setup. Until then you can try a
            simulation to see what Review will look like.
          </p>
        </div>
      </div>
    );
  }

  const r = current.result;
  const status = statusOf(r);
  const exp = current.experiment;
  const byId = (id: string): ArmCounts | undefined =>
    current.inputs.arms.find((a) => a.variantId === id);
  const minLift = (exp?.minLiftPp ?? current.inputs.minLiftPp) / 100;
  const window = exp?.responseWindowDays ?? 14;
  // T17: a send-time test compares WINDOWS (the email and subject are identical)
  const isSendTime = exp?.kind === "send_time";
  const windowOf = (variantId: string) =>
    exp?.arms?.find((x) => x.variantId === variantId)?.windowText ?? null;

  return (
    <div className="space-y-4">
      {current.simulated && (
        <div
          role="alert"
          className="flex flex-wrap items-center gap-3 rounded-lg border border-warning-text/40 bg-warning-bg px-4 py-2 text-sm font-semibold text-warning-text"
        >
          <span>SIMULATED DATA, not your results</span>
          {current.note && (
            <span className="basis-full text-tiny font-normal">{current.note}</span>
          )}
          <button
            onClick={() => setSim(null)}
            className="ml-auto rounded border border-warning-text/40 px-2 py-0.5 text-tiny font-medium hover:bg-surface"
          >
            Back to real results
          </button>
        </div>
      )}

      {/* 1. goal strip */}
      <div className={`${card} flex flex-wrap items-center gap-x-4 gap-y-2`}>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className={`rounded-full px-2 py-0.5 text-tiny font-medium ${PILL[status]}`}>
              {STATUS_LABEL[status]}
            </span>
            <span className="text-sm font-medium text-ink">
              {isSendTime
                ? `Goal: which send time gets more confirmed qualified replies within ${window} days`
                : `Goal: confirmed qualified replies within ${window} days`}
            </span>
            {isSendTime && (
              <span className="rounded bg-accent-soft px-2 py-0.5 text-tiny text-accent">
                Send-time test: same email, same subject
              </span>
            )}
          </div>
          <div className="mt-1 flex flex-wrap gap-x-4 text-tiny text-muted">
            {exp?.offerName && <span>Offer: {exp.offerName}</span>}
            {exp?.decisionDate && (
              <span>Decision date: {new Date(exp.decisionDate).toLocaleDateString()}</span>
            )}
            <span>
              Revision {current.revision} · computed{" "}
              {new Date(current.computedAt).toLocaleString()}
              {current.simulated ? " · simulated" : ""}
            </span>
          </div>
        </div>
        {!current.simulated && canManage && (
          <button
            onClick={() => void refresh()}
            disabled={busy}
            className="flex items-center gap-1.5 rounded border border-line-mid px-2.5 py-1.5 text-sm text-ink hover:bg-hover disabled:opacity-50"
          >
            <RefreshCw size={14} className={busy ? "animate-spin" : ""} /> Refresh
          </button>
        )}
        {simulationPicker}
      </div>

      {/* 2. variant table */}
      <div className={card}>
        <h3 className={h3}>{isSendTime ? "Send times" : "Versions"}</h3>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm">
            <thead>
              <tr className="text-left text-tiny uppercase tracking-wide text-faint">
                <th className="py-1 pr-3">{isSendTime ? "Send window" : "Version"}</th>
                <th className="px-2">Companies</th>
                <th className="px-2">Sent</th>
                <th className="px-2">Delivered</th>
                <th className="px-2">Bounce</th>
                <th className="px-2">Opens</th>
                <th className="px-2">Replies</th>
                <th className="px-2">Confirmed qualified</th>
                <th className="px-2">Booked</th>
                <th className="px-2">Unsub</th>
              </tr>
            </thead>
            <tbody>
              {r.arms.map((a: ArmReport) => {
                const c = byId(a.variantId);
                if (!c) return null;
                return (
                  <tr
                    key={a.variantId}
                    data-finding={findingOfArm(r.findings, a.variantId)}
                    className={`border-t border-line ${
                      hot.includes(findingOfArm(r.findings, a.variantId) ?? "-") ? "bg-accent-soft" : ""
                    }`}
                  >
                    <td className="py-1.5 pr-3 font-medium text-ink">
                      {a.label}
                      {a.isControl && <span className="ml-1 text-tiny text-faint">(control)</span>}
                      {r.winnerVariantId === a.variantId && (
                        <span className="ml-1 rounded bg-success-bg px-1.5 text-tiny text-success-text">
                          recommended
                        </span>
                      )}
                      {isSendTime && windowOf(a.variantId) && (
                        <div
                          className="text-tiny font-normal text-muted"
                          data-testid="arm-window"
                        >
                          {windowOf(a.variantId)}
                        </div>
                      )}
                    </td>
                    <td className="px-2"><Num r={current} n={c.assigned}>{c.assigned}</Num></td>
                    <td className="px-2"><Num r={current} n={c.sent}>{c.sent}</Num></td>
                    <td className="px-2"><Num r={current} n={c.sent}>{c.delivered}</Num></td>
                    <td className="px-2"><Num r={current} n={c.sent}>{pct(a.bounceRate)}</Num></td>
                    <td className="px-2"><Num r={current} n={c.delivered} grey>{pct(a.openRate)}</Num></td>
                    <td className="px-2"><Num r={current} n={c.assigned}>{c.replied}</Num></td>
                    <td className="px-2">
                      <Num r={current} n={c.assigned}>
                        <strong className="text-ink">{c.qualifiedVerified}</strong>{" "}
                        ({pct(a.qualifiedRate)}, {pct(a.qualifiedLo)} to {pct(a.qualifiedHi)})
                      </Num>
                      {c.qualifiedProvisional > 0 && (
                        <span className="ml-1 text-tiny text-warning-text">
                          +{c.qualifiedProvisional} unconfirmed
                        </span>
                      )}
                    </td>
                    <td className="px-2"><Num r={current} n={c.assigned}>{c.booked}</Num></td>
                    <td className="px-2"><Num r={current} n={c.delivered}>{pct(a.unsubscribeRate)}</Num></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-tiny text-faint">
          Counts are companies, not emails. Rates are confirmed qualified companies out of all
          companies given that version. {r.diagnosticNote}
        </p>
      </div>

      {/* 3. lift card */}
      {r.lift && (
        <div
          data-finding={r.findings?.find((f) => f.kind === "lift")?.id}
          className={`rounded-lg ${
            hot.includes(r.findings?.find((f) => f.kind === "lift")?.id ?? "-")
              ? "ring-2 ring-accent"
              : ""
          }`}
        >
          <LiftCard
            lift={r.lift}
            minLift={minLift}
            challenger={r.arms.find((a) => a.variantId === r.lift!.challengerId)?.label ?? "B"}
            control={r.arms.find((a) => a.variantId === r.lift!.controlId)?.label ?? "A"}
          />
        </div>
      )}

      {/* 4. checks */}
      <div className={card}>
        <h3 className={h3}>Checks</h3>
        <ul className="space-y-1.5">
          {r.gates.map((g) => (
            <li key={g.id} className="flex gap-2 text-sm">
              {g.passed ? (
                <Check size={16} className="mt-0.5 shrink-0 text-success-text" aria-label="passed" />
              ) : (
                <X size={16} className="mt-0.5 shrink-0 text-danger-text" aria-label="not passed" />
              )}
              <span className="text-ink">
                {g.reason}
                {g.nextCheck && (
                  <span className="text-muted"> Next check: {g.nextCheck}.</span>
                )}
                {g.warning && g.passed && (
                  <span className="text-warning-text"> ({g.warning})</span>
                )}
              </span>
            </li>
          ))}
        </ul>
      </div>

      {/* 5. recommendation */}
      <div className={card}>
        <h3 className={h3}>Recommendation</h3>
        <p className="text-sm font-medium text-ink">{current.explanation.summary}</p>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-muted">
          {current.explanation.points.map((p, i) => (
            <li
              key={i}
              onMouseEnter={() => setHot(p.findingIds)}
              onMouseLeave={() => setHot([])}
              onFocus={() => setHot(p.findingIds)}
              onBlur={() => setHot([])}
              tabIndex={0}
              className="rounded outline-none focus:bg-hover hover:bg-hover"
            >
              {p.text}
              {current.explanationSource !== "template" && (
                <span className="ml-1.5 text-micro text-faint">
                  [{p.findingIds.join(", ")}]
                </span>
              )}
            </li>
          ))}
        </ul>
        {current.explanationSource === "agent" && (
          <p className="mt-2 text-tiny text-faint" data-testid="explained-by-agent">
            Explained by Expelly Review agent. Hover a point to see the number it
            relies on; the app checked every number against the table above. Policy{" "}
            {current.policyVersion}.
          </p>
        )}
        {current.explanationSource === "gemini" && (
          <p className="mt-2 text-tiny text-faint">
            Explained by Gemini; the app checked every number against the table above. Policy{" "}
            {current.policyVersion}.
          </p>
        )}
        {current.explanationSource === "template" && (
          <p className="mt-2 text-tiny text-faint">
            Written from the numbers above, not by AI ({current.explanationSource}).
            {current.explanation.fallbackReason
              ? " An AI explanation was tried but did not pass the app's checks."
              : ""}{" "}
            Policy {current.policyVersion}.
          </p>
        )}
        <ReviewActions
          review={current}
          canManage={canManage}
          templateId={templateId}
          onChanged={() => {
            void load();
            onChanged?.();
          }}
        />
      </div>

      {/* 6. audience slices */}
      <div className={card}>
        <h3 className={h3}>
          Audience slices <span className="font-normal text-faint">· Exploratory: not a decision</span>
        </h3>
        <div className="grid gap-4 lg:grid-cols-3">
          {r.slices.map((s) => (
            <div key={s.factor} className="overflow-x-auto">
              <div className="mb-1 text-tiny font-medium uppercase tracking-wide text-faint">
                {FACTOR_LABEL[s.factor]}
              </div>
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-tiny text-faint">
                    <th className="pr-2 font-normal">Group</th>
                    <th className="px-1 font-normal">Cos.</th>
                    {r.arms.map((a) => (
                      <th key={a.variantId} className="px-1 font-normal">
                        {a.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {s.buckets.map((b) => (
                    <tr key={b.value} className="border-t border-line">
                      <td className={`pr-2 ${b.value === "unknown" ? "text-faint" : "text-ink"}`}>
                        {prettyValue(b.value)}
                      </td>
                      <td className="px-1 text-muted">{b.assigned}</td>
                      {r.arms.map((a) => {
                        const x = b.arms.find((y) => y.variantId === a.variantId);
                        return (
                          <td
                            key={a.variantId}
                            className="px-1 text-muted"
                            title={source(current, x?.assigned ?? 0)}
                          >
                            {pct(x?.rate ?? null)}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </div>
        <p className="mt-2 text-tiny text-faint">
          Groups with fewer than 10 companies are folded into &quot;other&quot;. A group that looks strong
          may just reflect what else is true of it (for example, the buying trigger). Use these
          as ideas to test, never as a verdict.
        </p>
      </div>
    </div>
  );
}

/** The finding id of a version's rate (F1, F2, ...), so a hovered point can highlight its row. */
function findingOfArm(
  findings: { id: string; kind: string; variantId?: string }[] | undefined,
  variantId: string,
): string | undefined {
  return findings?.find((f) => f.kind === "rate" && f.variantId === variantId)?.id;
}

/** Lift with its range, drawn against the smallest lift worth acting on. */
function LiftCard({
  lift,
  minLift,
  challenger,
  control,
}: {
  lift: { d: number; lo: number; hi: number };
  minLift: number;
  challenger: string;
  control: string;
}) {
  const pad = 0.01;
  const min = Math.min(lift.lo, 0, minLift) - pad;
  const max = Math.max(lift.hi, 0, minLift) + pad;
  const at = (v: number) => `${(((v - min) / (max - min)) * 100).toFixed(2)}%`;
  return (
    <div className={card}>
      <h3 className={h3}>Difference</h3>
      <p className="text-sm text-ink">
        <strong>
          {challenger} vs {control}: {signedPts(lift.d)} points
        </strong>{" "}
        <span className="text-muted">
          (range {signedPts(lift.lo)} to {signedPts(lift.hi)})
        </span>
      </p>
      <div
        className="relative mt-4 h-8"
        role="img"
        aria-label={`Range ${signedPts(lift.lo)} to ${signedPts(lift.hi)} points, minimum worthwhile ${signedPts(minLift)}`}
      >
        <div className="absolute inset-x-0 top-1/2 h-px bg-line-mid" />
        <div
          className="absolute top-1/2 h-2 -translate-y-1/2 rounded bg-accent-soft2"
          style={{ left: at(lift.lo), width: `calc(${at(lift.hi)} - ${at(lift.lo)})` }}
        />
        <div
          className="absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-accent"
          style={{ left: at(lift.d) }}
        />
        <div className="absolute inset-y-0 w-px bg-ink" style={{ left: at(0) }} title="No difference" />
        <div
          className="absolute inset-y-0 border-l border-dashed border-success-text"
          style={{ left: at(minLift) }}
          title={`Smallest lift worth acting on: ${signedPts(minLift)} points`}
        />
      </div>
      <div className="mt-1 flex justify-between text-tiny text-faint">
        <span>0 = no difference</span>
        <span className="text-success-text">dashed = smallest worthwhile lift ({signedPts(minLift)})</span>
      </div>
    </div>
  );
}
