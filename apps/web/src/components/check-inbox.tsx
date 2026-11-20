"use client";

import { useState } from "react";
import { MailCheck } from "lucide-react";
import { api, errorMessage } from "@/lib/api";

/**
 * "Confirm your email" panel: shown after sign-up and when someone tries to
 * log in before confirming. Resend is rate-limited on the server
 * (3 per 10 minutes); here it just waits 30 s between clicks.
 */
export function CheckInbox({ email, intro }: { email: string; intro?: string }) {
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(false);

  async function resend() {
    setState("sending");
    setError(null);
    try {
      await api("/auth/resend-verification", {
        method: "POST",
        body: JSON.stringify({ email }),
      });
      setState("sent");
      setCooldown(true);
      setTimeout(() => setCooldown(false), 30_000);
    } catch (e) {
      setState("error");
      setError(errorMessage(e, "Couldn't send it right now. Try again in a few minutes."));
    }
  }

  return (
    <div className="rounded-lg border border-line bg-surface p-5">
      <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-accent-soft text-accent">
        <MailCheck size={20} />
      </div>
      <h2 className="mb-1 text-section font-semibold text-ink2">Check your inbox</h2>
      <p className="text-sm text-muted">
        {intro ?? "We sent a confirmation link to"} <b className="text-ink">{email}</b>.
        Click it to finish and get into Expelly. The link works for 24 hours.
      </p>
      <p className="mt-3 text-tiny text-faint">
        Not there? Check spam and promotions, or send a new link.
      </p>
      <button
        onClick={() => void resend()}
        disabled={state === "sending" || cooldown}
        className="mt-4 rounded border border-line-mid px-3 py-1.5 text-sm font-medium text-ink hover:bg-hover disabled:opacity-50"
      >
        {state === "sending" ? "Sending…" : cooldown ? "Sent. Check your inbox" : "Resend link"}
      </button>
      {error && <p className="mt-3 text-sm text-danger-text">{error}</p>}
    </div>
  );
}
