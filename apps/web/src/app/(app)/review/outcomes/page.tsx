"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { errorMessage } from "@/lib/api";
import { toast } from "@/components/feedback";
import { timeAgo } from "@/lib/analytics";
import { ReviewNav } from "@/components/review-nav";
import {
  listOutcomes,
  listUnattributed,
  OUTCOME_LABEL,
  Outcome,
  verifyOutcome,
} from "@/lib/outcomes";

/** Review queue: replies waiting for a person, and results we couldn't tie to a campaign. */
export default function OutcomesQueuePage() {
  const [pending, setPending] = useState<Outcome[] | null>(null);
  const [stray, setStray] = useState<Outcome[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [p, u] = await Promise.all([
      listOutcomes({ status: "provisional" }),
      listUnattributed(),
    ]);
    setPending(p);
    setStray(u);
  }, []);

  useEffect(() => {
    void load().catch((e) => toast(errorMessage(e), "error"));
  }, [load]);

  async function decide(o: Outcome, decision: "verified" | "rejected") {
    setBusy(o.id);
    try {
      await verifyOutcome(o.id, decision);
      await load();
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setBusy(null);
    }
  }

  const who = (o: Outcome) => o.lead_name ?? o.lead_email ?? "Unknown lead";

  return (
    <div className="mx-auto max-w-4xl space-y-8 p-6">
      <header>
        <h1 className="text-xl font-semibold text-ink2">Review</h1>
        <p className="mt-1 text-sm text-muted">
          Clear these so test results count. The AI only proposes; a person decides.
        </p>
      </header>
      <ReviewNav />

      <section>
        <h2 className="mb-2 text-section font-semibold text-ink2">
          Waiting for your decision {pending ? `(${pending.length})` : ""}
        </h2>
        {pending === null ? (
          <p className="text-sm text-muted">Loading…</p>
        ) : pending.length === 0 ? (
          <p className="rounded-lg border border-line bg-surface p-4 text-sm text-muted">
            Nothing waiting. Interested replies show up here until someone confirms them.
          </p>
        ) : (
          <ul className="divide-y divide-line rounded-lg border border-line bg-surface">
            {pending.map((o) => (
              <li key={o.id} className="flex flex-wrap items-center gap-3 p-3 text-sm">
                <div className="min-w-0 flex-1">
                  <div className="font-medium text-ink">
                    {who(o)}
                    {o.lead_company ? ` · ${o.lead_company}` : ""}
                  </div>
                  <div className="text-tiny text-faint">
                    {o.source === "inbox_ai" ? "AI: " : ""}
                    {OUTCOME_LABEL[o.type].toLowerCase()} (unconfirmed)
                    {o.campaign_name ? ` · ${o.campaign_name}` : " · no campaign"}
                    {` · ${timeAgo(o.occurred_at)}`}
                    {o.conversation_id && (
                      <>
                        {" · "}
                        <Link
                          href={`/inbox?c=${o.conversation_id}`}
                          className="text-accent hover:underline"
                        >
                          Open reply
                        </Link>
                      </>
                    )}
                  </div>
                </div>
                <button
                  disabled={busy === o.id}
                  onClick={() => void decide(o, "verified")}
                  className="rounded bg-accent px-2.5 py-1 text-tiny font-medium text-white hover:bg-accent-hover disabled:opacity-60"
                >
                  {o.type === "booked_call" ? "Confirm booked" : "Confirm qualified"}
                </button>
                <button
                  disabled={busy === o.id}
                  onClick={() => void decide(o, "rejected")}
                  className="rounded border border-line-mid px-2.5 py-1 text-tiny text-ink hover:bg-hover disabled:opacity-60"
                >
                  {o.type === "booked_call" ? "Not booked" : "Not qualified"}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2 className="mb-1 text-section font-semibold text-ink2">
          Not tied to a campaign {stray ? `(${stray.length})` : ""}
        </h2>
        <p className="mb-2 text-sm text-muted">
          Replies we could not match to one campaign email (or the lead is in several
          campaigns and the reply names none). They are kept but not counted in any test.
        </p>
        {stray === null ? (
          <p className="text-sm text-muted">Loading…</p>
        ) : stray.length === 0 ? (
          <p className="rounded-lg border border-line bg-surface p-4 text-sm text-muted">
            Everything is attributed.
          </p>
        ) : (
          <ul className="divide-y divide-line rounded-lg border border-line bg-surface">
            {stray.map((o) => (
              <li key={o.id} className="p-3 text-sm">
                <div className="font-medium text-ink">
                  {who(o)}
                  {o.lead_company ? ` · ${o.lead_company}` : ""}
                </div>
                <div className="text-tiny text-faint">
                  {OUTCOME_LABEL[o.type]} · {timeAgo(o.occurred_at)}
                  {o.reason ? ` · ${o.reason}` : ""}
                  {o.conversation_id && (
                    <>
                      {" · "}
                      <Link
                        href={`/inbox?c=${o.conversation_id}`}
                        className="text-accent hover:underline"
                      >
                        Open reply
                      </Link>
                    </>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
