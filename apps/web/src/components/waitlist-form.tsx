"use client";

import Link from "next/link";
import { useState } from "react";
import { CheckCircle2 } from "lucide-react";
import { api, errorMessage } from "@/lib/api";
import { BRAND } from "@/lib/marketing";

const field =
  "w-full rounded border border-line-mid bg-white px-3 py-2 text-base outline-none focus:border-accent focus:ring-2 focus:ring-accent-soft2";

/** Shown instead of sign-up while SIGNUP_MODE=waitlist and no invite code. */
export function WaitlistForm() {
  const [form, setForm] = useState({ email: "", name: "", company: "", useCase: "" });
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      await api("/waitlist", { method: "POST", body: JSON.stringify(form) });
      setDone(true);
    } catch (e2) {
      setErr(errorMessage(e2, "Couldn't join the waitlist. Try again in a minute."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-page px-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded bg-accent text-tiny font-semibold text-white">
            SS
          </div>
          <span className="text-section font-semibold text-ink2">{BRAND.name}</span>
        </div>
        {done ? (
          <div className="rounded-lg border border-line bg-white p-6">
            <CheckCircle2 size={22} className="text-success-text" />
            <h1 className="mt-3 text-title font-semibold text-ink2">You&apos;re on the list</h1>
            <p className="mt-1.5 text-sm text-muted">
              We&apos;re letting teams in gradually during the beta. We&apos;ll email you an invite
              link as soon as a spot opens.
            </p>
          </div>
        ) : (
          <>
            <h1 className="mb-1 text-title font-semibold text-ink2">Join the beta waitlist</h1>
            <p className="mb-6 text-sm text-muted">
              {BRAND.name} is invite-only while in beta. Tell us a little about you and we&apos;ll
              send an invite.
            </p>
            <form onSubmit={submit} className="space-y-3">
              <input
                type="email"
                required
                placeholder="Work email"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                className={field}
              />
              <input
                placeholder="Your name"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                className={field}
              />
              <input
                placeholder="Company"
                value={form.company}
                onChange={(e) => setForm({ ...form, company: e.target.value })}
                className={field}
              />
              <textarea
                rows={3}
                placeholder="Who do you want to reach, and how many emails a month?"
                value={form.useCase}
                onChange={(e) => setForm({ ...form, useCase: e.target.value })}
                className={field}
              />
              {err && (
                <p className="rounded bg-danger-bg px-3 py-2 text-sm text-danger-text">{err}</p>
              )}
              <button
                type="submit"
                disabled={busy}
                className="w-full rounded bg-accent px-3 py-2 text-base font-medium text-white hover:bg-accent-hover disabled:opacity-60"
              >
                {busy ? "Joining…" : "Join the waitlist"}
              </button>
            </form>
            <p className="mt-6 text-sm text-muted">
              Have an account?{" "}
              <Link href="/login" className="font-medium text-accent">
                Log in
              </Link>
            </p>
          </>
        )}
      </div>
    </main>
  );
}
