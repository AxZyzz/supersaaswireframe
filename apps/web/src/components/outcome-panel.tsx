"use client";

import { useCallback, useEffect, useState } from "react";
import { BadgeCheck, CircleHelp, ThumbsDown, ThumbsUp } from "lucide-react";
import { errorMessage } from "@/lib/api";
import { toast } from "@/components/feedback";
import {
  getRubric,
  listOutcomes,
  OUTCOME_LABEL,
  Outcome,
  verifyOutcome,
} from "@/lib/outcomes";

const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString() : "");

/**
 * Inbox: what the AI thinks about this reply, and the person's decision.
 * AI labels are provisional until someone confirms them; changing a decision
 * that was already made needs a reason (the history keeps every step).
 */
export function OutcomePanel({
  conversationId,
  refreshKey,
  onChanged,
}: {
  conversationId: string;
  /** Changes when the conversation reloads (e.g. "converted" toggled). */
  refreshKey?: string | null;
  onChanged?: () => void;
}) {
  const [items, setItems] = useState<Outcome[]>([]);
  const [rubric, setRubric] = useState<string>("");
  const [changing, setChanging] = useState<{
    id: string;
    to: "verified" | "rejected";
  } | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setItems(await listOutcomes({ conversationId }));
  }, [conversationId]);

  useEffect(() => {
    void load().catch(() => setItems([]));
  }, [load, refreshKey]);
  useEffect(() => {
    void getRubric()
      .then((r) => setRubric(r.rubric))
      .catch(() => setRubric(""));
  }, []);

  async function decide(o: Outcome, to: "verified" | "rejected", why?: string) {
    setBusy(true);
    try {
      await verifyOutcome(o.id, to, why);
      setChanging(null);
      setReason("");
      await load();
      onChanged?.();
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setBusy(false);
    }
  }

  // nothing the AI or a person said about this thread yet
  if (items.length === 0) return null;

  return (
    <div className="space-y-2 border-b border-line bg-surface px-4 py-2 text-sm">
      {items.map((o) => {
        const label = OUTCOME_LABEL[o.type];
        const provisional = o.verification === "provisional";
        const yes = o.type === "booked_call" ? "Confirm booked" : "Confirm qualified";
        const no = o.type === "booked_call" ? "Not booked" : "Not qualified";
        return (
          <div key={o.id} className="space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              {provisional ? (
                <span className="flex items-center gap-1 rounded bg-warning-bg px-2 py-0.5 text-tiny font-medium text-warning-text">
                  <CircleHelp size={13} />
                  {o.source === "inbox_ai"
                    ? `AI: ${label.toLowerCase()} (unconfirmed)`
                    : `${label} (unconfirmed)`}
                </span>
              ) : o.verification === "verified" ? (
                <span className="flex items-center gap-1 rounded bg-success-bg px-2 py-0.5 text-tiny font-medium text-success-text">
                  <BadgeCheck size={13} /> {label}: confirmed
                </span>
              ) : (
                <span className="flex items-center gap-1 rounded bg-hover px-2 py-0.5 text-tiny font-medium text-muted">
                  <ThumbsDown size={13} /> Not {label.toLowerCase()}
                </span>
              )}
              {!provisional && (
                <span className="text-tiny text-faint">
                  {o.verified_by_name
                    ? `by ${o.verified_by_name}`
                    : o.source === "calendar"
                      ? "from Google Calendar"
                      : "by the team"}
                  {o.verified_at ? ` · ${when(o.verified_at)}` : ""}
                  {o.reason ? ` · “${o.reason}”` : ""}
                </span>
              )}
              {provisional && (
                <>
                  <button
                    disabled={busy}
                    onClick={() => void decide(o, "verified")}
                    className="flex items-center gap-1 rounded bg-accent px-2 py-1 text-tiny font-medium text-white hover:bg-accent-hover disabled:opacity-60"
                  >
                    <ThumbsUp size={12} /> {yes}
                  </button>
                  <button
                    disabled={busy}
                    onClick={() => void decide(o, "rejected")}
                    className="flex items-center gap-1 rounded border border-line-mid px-2 py-1 text-tiny text-ink hover:bg-hover disabled:opacity-60"
                  >
                    <ThumbsDown size={12} /> {no}
                  </button>
                </>
              )}
              {!provisional && changing?.id !== o.id && (
                <button
                  onClick={() => {
                    setChanging({
                      id: o.id,
                      to: o.verification === "verified" ? "rejected" : "verified",
                    });
                    setReason("");
                  }}
                  className="text-tiny text-accent hover:underline"
                >
                  Change
                </button>
              )}
            </div>
            {changing?.id === o.id && (
              <div className="flex flex-wrap items-center gap-2">
                <input
                  autoFocus
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder={`Why change to "${changing.to === "verified" ? yes : no}"?`}
                  className="min-w-64 flex-1 rounded border border-line-mid bg-surface px-2.5 py-1 text-sm outline-none focus:border-accent"
                />
                <button
                  disabled={busy || reason.trim().length < 3}
                  onClick={() => void decide(o, changing.to, reason.trim())}
                  className="rounded bg-accent px-2 py-1 text-tiny font-medium text-white hover:bg-accent-hover disabled:opacity-60"
                >
                  Save change
                </button>
                <button
                  onClick={() => setChanging(null)}
                  className="text-tiny text-muted hover:text-ink"
                >
                  Cancel
                </button>
              </div>
            )}
          </div>
        );
      })}
      {rubric && (
        <p className="text-tiny text-faint">
          <span className="font-medium text-muted">What counts as qualified: </span>
          {rubric}
        </p>
      )}
    </div>
  );
}
