"use client";

import { usePathname } from "next/navigation";
import { useState } from "react";
import { MessageSquarePlus, X } from "lucide-react";
import { api } from "@/lib/api";
import { toast } from "@/components/feedback";

const KINDS = [
  { value: "bug", label: "Something's broken" },
  { value: "idea", label: "Idea / request" },
  { value: "other", label: "Other" },
] as const;

/** Header button → small modal; lands in the operator console (T10.7). */
export function FeedbackButton() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<(typeof KINDS)[number]["value"]>("idea");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  async function send() {
    if (!message.trim()) return;
    setBusy(true);
    try {
      await api("/feedback", {
        method: "POST",
        body: JSON.stringify({ kind, message, page: pathname }),
      });
      toast("Thanks — we read every message.");
      setMessage("");
      setOpen(false);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="hidden items-center gap-1.5 rounded px-2 py-1 text-tiny text-muted hover:bg-hover hover:text-ink sm:flex"
      >
        <MessageSquarePlus size={14} /> Feedback
      </button>
      {open && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center bg-black/20 px-4 pt-[14vh]"
          onMouseDown={() => setOpen(false)}
        >
          <div
            role="dialog"
            aria-label="Send feedback"
            className="w-full max-w-md rounded-lg border border-line bg-surface p-4 shadow-float"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-ink2">Send feedback</h2>
              <button onClick={() => setOpen(false)} className="text-faint hover:text-ink" aria-label="Close">
                <X size={16} />
              </button>
            </div>
            <div className="mb-3 flex gap-1.5">
              {KINDS.map((k) => (
                <button
                  key={k.value}
                  onClick={() => setKind(k.value)}
                  className={`rounded-full border px-2.5 py-1 text-tiny ${
                    kind === k.value
                      ? "border-accent bg-accent-soft text-accent"
                      : "border-line-mid text-muted hover:bg-hover"
                  }`}
                >
                  {k.label}
                </button>
              ))}
            </div>
            <textarea
              autoFocus
              rows={5}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="What happened, or what would make this better?"
              className="w-full rounded border border-line-mid px-2.5 py-2 text-sm outline-none focus:border-accent focus:ring-2 focus:ring-accent-soft2"
            />
            <div className="mt-3 flex items-center justify-between">
              <span className="text-tiny text-faint">Sent with the page you&apos;re on.</span>
              <button
                onClick={() => void send()}
                disabled={busy || !message.trim()}
                className="rounded bg-accent px-3 py-1.5 text-sm font-medium text-white hover:bg-accent-hover disabled:opacity-50"
              >
                {busy ? "Sending…" : "Send"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
