"use client";

import { useCallback, useEffect, useState } from "react";
import { Trophy } from "lucide-react";
import { api, errorMessage } from "@/lib/api";
import { toast } from "@/components/feedback";

interface StepAdvice {
  stepId: string;
  stepOrder: number;
  variants: {
    index: number;
    subject: string;
    sent: number;
    replies: number;
    opens: number;
    replyRate: number;
    probBest: number;
  }[];
  suggestion: { index: number; probBest: number } | null;
  reason: string;
  /** Version already sent to the remaining leads, if approved. */
  winnerIndex: number | null;
}

const letter = (i: number) => String.fromCharCode(65 + i);

/**
 * Self-optimising A/B: shows which subject version is winning on replies and
 * suggests sending the winner to the remaining leads. Nothing changes until
 * the user approves.
 */
export function WinnerPanel({
  campaignId,
  canManage,
  onApplied,
}: {
  campaignId: string;
  canManage: boolean;
  onApplied?: () => void;
}) {
  const [steps, setSteps] = useState<StepAdvice[] | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(
    () =>
      api<StepAdvice[]>(`/campaigns/${campaignId}/winner`)
        .then(setSteps)
        .catch(() => setSteps([])),
    [campaignId],
  );

  useEffect(() => {
    void load();  
  }, [load]);

  async function apply(stepId: string, variantIndex: number) {
    if (
      !window.confirm(
        `Send version ${letter(variantIndex)} to all remaining leads on this step? The other versions stop being used.`,
      )
    )
      return;
    setBusy(true);
    try {
      await api(`/campaigns/${campaignId}/apply-winner`, {
        method: "POST",
        body: JSON.stringify({ stepId, variantIndex }),
      });
      toast(`Version ${letter(variantIndex)} now goes to the remaining leads.`);
      await load();
      onApplied?.();
    } catch (e) {
      toast(errorMessage(e, "Couldn't apply the winner."), "error");
    }
    setBusy(false);
  }

  if (!steps || steps.length === 0) return null;

  return (
    <div className="mt-4 space-y-3">
      {steps.map((s) => (
        <div key={s.stepId} className="rounded-lg border border-line bg-panel p-3">
          <div className="mb-2 flex items-center gap-1.5 text-tiny font-semibold uppercase tracking-wide text-faint">
            <Trophy size={12} className="text-amber-500" /> Legacy rotation (not a test) · Winner check · step {s.stepOrder}
            <span className="font-normal normal-case tracking-normal">(judged on replies)</span>
          </div>
          <div className="space-y-1.5">
            {s.variants.map((v) => {
              const lead = s.suggestion?.index === v.index;
              return (
                <div key={v.index} className="flex items-center gap-2 text-sm">
                  <span className={`w-5 font-semibold ${lead ? "text-accent" : "text-muted"}`}>
                    {letter(v.index)}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-ink" title={v.subject}>
                    {v.subject}
                  </span>
                  <span className="w-28 text-right text-tiny text-muted">
                    {v.replies}/{v.sent} replied
                  </span>
                  <div className="h-1.5 w-24 overflow-hidden rounded-full bg-surface" title="Chance this version is the best">
                    <div
                      className={`h-full rounded-full ${lead ? "bg-accent" : "bg-line-mid"}`}
                      style={{ width: `${Math.round(v.probBest * 100)}%` }}
                    />
                  </div>
                  <span className="w-10 text-right text-tiny text-muted">
                    {Math.round(v.probBest * 100)}%
                  </span>
                </div>
              );
            })}
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <p className="flex-1 text-tiny text-muted">{s.reason}</p>
            {s.winnerIndex !== null && (
              <span className="rounded-full bg-accent-soft px-2 py-0.5 text-tiny font-medium text-accent">
                Winner applied: {letter(s.winnerIndex)} goes to remaining leads
              </span>
            )}
            {s.winnerIndex === null && s.suggestion && canManage && (
              <button
                disabled={busy}
                onClick={() => void apply(s.stepId, s.suggestion!.index)}
                className="rounded bg-accent px-3 py-1 text-tiny font-medium text-white hover:bg-accent-hover disabled:opacity-60"
              >
                Send {letter(s.suggestion.index)} to remaining leads
              </button>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
