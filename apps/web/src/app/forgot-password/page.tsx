"use client";

import Link from "next/link";
import { useState } from "react";
import { api, errorMessage } from "@/lib/api";
import { AuthCard, authButton, authInput } from "@/components/auth-card";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api("/auth/forgot-password", {
        method: "POST",
        body: JSON.stringify({ email }),
      });
      setSent(true);
    } catch (err) {
      setError(errorMessage(err, "Something went wrong. Try again."));
    }
    setBusy(false);
  }

  if (sent) {
    return (
      <AuthCard
        title="Check your email"
        subtitle={`If ${email} has an account, we've sent a link to reset the password. It works for 60 minutes.`}
      >
        <p className="text-sm text-muted">
          Nothing there? Check spam, or{" "}
          <button onClick={() => setSent(false)} className="font-medium text-accent">
            try another email
          </button>
          .
        </p>
        <p className="mt-6 text-sm text-muted">
          <Link href="/login" className="font-medium text-accent">
            Back to log in
          </Link>
        </p>
      </AuthCard>
    );
  }

  return (
    <AuthCard
      title="Reset your password"
      subtitle="Enter your account email and we'll send you a reset link."
    >
      <form onSubmit={onSubmit} className="space-y-4">
        <label className="block">
          <span className="mb-1 block text-sm font-medium text-ink">Email</span>
          <input
            type="email"
            required
            autoFocus
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className={authInput}
            placeholder="you@company.com"
          />
        </label>
        {error && (
          <p className="rounded bg-danger-bg px-3 py-2 text-sm text-danger-text">{error}</p>
        )}
        <button type="submit" disabled={busy} className={authButton}>
          {busy ? "Sending…" : "Send reset link"}
        </button>
      </form>
      <p className="mt-6 text-sm text-muted">
        Remembered it?{" "}
        <Link href="/login" className="font-medium text-accent">
          Log in
        </Link>
      </p>
    </AuthCard>
  );
}
