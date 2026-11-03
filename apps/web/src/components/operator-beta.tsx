"use client";

import { useCallback, useEffect, useState } from "react";
import { Check, Copy, Inbox, MessageSquare } from "lucide-react";
import { api } from "@/lib/api";
import { timeAgo } from "@/lib/analytics";

interface WaitlistRow {
  id: string;
  email: string;
  name: string | null;
  company: string | null;
  use_case: string | null;
  status: "pending" | "approved" | "joined";
  created_at: string;
}
interface FeedbackRow {
  id: string;
  kind: string;
  message: string;
  page: string | null;
  created_at: string;
  org_name: string;
  user_name: string | null;
  user_email: string | null;
}

const STATUS_TONE: Record<WaitlistRow["status"], string> = {
  pending: "bg-warning-bg text-warning-text",
  approved: "bg-accent-soft text-accent",
  joined: "bg-success-bg text-success-text",
};

/** Operator console: beta waitlist approvals + in-app feedback (T10.7). */
export function OperatorBeta() {
  const [waitlist, setWaitlist] = useState<WaitlistRow[]>([]);
  const [feedback, setFeedback] = useState<FeedbackRow[]>([]);
  const [links, setLinks] = useState<Record<string, string>>({});
  const [copied, setCopied] = useState<string | null>(null);

  const fetchAndApply = useCallback(
    (isLive: () => boolean = () => true) =>
      Promise.all([
        api<WaitlistRow[]>("/operator/waitlist"),
        api<FeedbackRow[]>("/operator/feedback"),
      ]).then(([w, f]) => {
        if (!isLive()) return;
        setWaitlist(w);
        setFeedback(f);
      }),
    [],
  );
  const load = useCallback(() => fetchAndApply(), [fetchAndApply]);

  useEffect(() => {
    let live = true;
    void fetchAndApply(() => live);
    return () => {
      live = false;
    };
  }, [fetchAndApply]);

  async function approve(row: WaitlistRow) {
    const r = await api<{ code: string; email: string }>(
      `/operator/waitlist/${row.id}/approve`,
      { method: "POST" },
    );
    const link = `${window.location.origin}/signup?code=${encodeURIComponent(r.code)}&email=${encodeURIComponent(r.email)}`;
    setLinks((l) => ({ ...l, [row.id]: link }));
    void load();
  }

  function copy(id: string, text: string) {
    void navigator.clipboard.writeText(text);
    setCopied(id);
    setTimeout(() => setCopied(null), 1500);
  }

  const pending = waitlist.filter((w) => w.status === "pending").length;

  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <section className="rounded-lg border border-line bg-surface p-4">
        <h2 className="mb-1 flex items-center gap-2 text-sm font-semibold text-ink2">
          <Inbox size={15} className="text-faint" /> Beta waitlist
          {pending > 0 && (
            <span className="rounded-full bg-warning-bg px-1.5 text-micro text-warning-text">
              {pending} pending
            </span>
          )}
        </h2>
        <p className="mb-3 text-tiny text-muted">
          Approve to get a single-use sign-up link for that email. Send it from your inbox.
        </p>
        {waitlist.length === 0 ? (
          <p className="text-sm text-muted">No one on the waitlist yet.</p>
        ) : (
          <ul className="max-h-96 divide-y divide-line overflow-y-auto">
            {waitlist.map((w) => (
              <li key={w.id} className="py-2.5">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium text-ink">
                      {w.name ? `${w.name} · ` : ""}
                      {w.email}
                    </div>
                    <div className="text-tiny text-muted">
                      {w.company ?? "—"} · joined list {timeAgo(w.created_at)}
                    </div>
                    {w.use_case && (
                      <p className="mt-1 line-clamp-2 text-tiny text-muted">{w.use_case}</p>
                    )}
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <span className={`rounded-full px-2 py-0.5 text-micro ${STATUS_TONE[w.status]}`}>
                      {w.status}
                    </span>
                    {w.status !== "joined" && (
                      <button
                        onClick={() => void approve(w)}
                        className="rounded border border-line-mid px-2 py-0.5 text-tiny text-ink hover:bg-hover"
                      >
                        {w.status === "approved" ? "New link" : "Approve"}
                      </button>
                    )}
                  </div>
                </div>
                {links[w.id] && (
                  <div className="mt-2 flex items-center gap-2">
                    <code className="min-w-0 flex-1 truncate rounded bg-panel px-2 py-1 text-tiny">
                      {links[w.id]}
                    </code>
                    <button
                      onClick={() => copy(w.id, links[w.id])}
                      className="flex items-center gap-1 rounded border border-line-mid px-2 py-1 text-tiny hover:bg-hover"
                    >
                      {copied === w.id ? <Check size={12} /> : <Copy size={12} />}
                      {copied === w.id ? "Copied" : "Copy"}
                    </button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="rounded-lg border border-line bg-surface p-4">
        <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-ink2">
          <MessageSquare size={15} className="text-faint" /> Feedback
        </h2>
        {feedback.length === 0 ? (
          <p className="text-sm text-muted">No feedback yet.</p>
        ) : (
          <ul className="max-h-96 divide-y divide-line overflow-y-auto">
            {feedback.map((f) => (
              <li key={f.id} className="py-2.5 text-sm">
                <div className="flex justify-between gap-2 text-tiny text-muted">
                  <span>
                    <span className="mr-1.5 rounded bg-panel px-1.5 py-0.5 uppercase">{f.kind}</span>
                    {f.org_name} · {f.user_name ?? f.user_email ?? "deleted user"}
                    {f.page && ` · ${f.page}`}
                  </span>
                  <span className="shrink-0">{timeAgo(f.created_at)}</span>
                </div>
                <p className="mt-1 whitespace-pre-wrap text-ink">{f.message}</p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
