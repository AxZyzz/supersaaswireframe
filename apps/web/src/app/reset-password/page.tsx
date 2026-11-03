"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useSyncExternalStore } from "react";
import { api, errorMessage } from "@/lib/api";
import { AuthCard, authButton, authInput } from "@/components/auth-card";

const noopSubscribe = () => () => {};

export default function ResetPasswordPage() {
  const router = useRouter();
  // ?token= from the emailed link (null on the server / during hydration).
  const token = useSyncExternalStore(
    noopSubscribe,
    () => new URLSearchParams(window.location.search).get("token") ?? "",
    () => null,
  );
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (password !== confirm) {
      setError("The two passwords don't match.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api("/auth/reset-password", {
        method: "POST",
        body: JSON.stringify({ token, password }),
      });
      setDone(true);
    } catch (err) {
      setError(errorMessage(err, "Something went wrong. Try again."));
      setBusy(false);
    }
  }

  if (token === null) return null; // first render, before the URL is read

  if (!token) {
    return (
      <AuthCard
        title="Link incomplete"
        subtitle="This reset link is missing its code. Open the link from the email again, or request a new one."
      >
        <Link href="/forgot-password" className="text-sm font-medium text-accent">
          Request a new link
        </Link>
      </AuthCard>
    );
  }

  if (done) {
    return (
      <AuthCard
        title="Password updated"
        subtitle="You've been signed out everywhere else. Log in with your new password."
      >
        <button onClick={() => router.replace("/login")} className={authButton}>
          Go to log in
        </button>
      </AuthCard>
    );
  }

  return (
    <AuthCard title="Choose a new password" subtitle="At least 8 characters.">
      <form onSubmit={onSubmit} className="space-y-4">
        <label className="block">
          <span className="mb-1 block text-sm font-medium text-ink">New password</span>
          <input
            type="password"
            required
            minLength={8}
            autoFocus
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className={authInput}
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-sm font-medium text-ink">Repeat it</span>
          <input
            type="password"
            required
            minLength={8}
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            className={authInput}
          />
        </label>
        {error && (
          <p className="rounded bg-danger-bg px-3 py-2 text-sm text-danger-text">
            {error}{" "}
            {/expired|invalid/i.test(error) && (
              <Link href="/forgot-password" className="font-medium underline">
                Get a new link
              </Link>
            )}
          </p>
        )}
        <button type="submit" disabled={busy} className={authButton}>
          {busy ? "Saving…" : "Set new password"}
        </button>
      </form>
    </AuthCard>
  );
}
