"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { api, ApiError, setSession } from "@/lib/api";

/** Same-origin path from ?next= (e.g. back to an invite link). Anything that
 *  could leave the site (//host, /\host, absolute URLs) falls back. */
function safeNext(): string {
  const next = new URLSearchParams(window.location.search).get("next");
  return next && next.startsWith("/") && !/^\/[/\\]/.test(next)
    ? next
    : "/dashboard";
}

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await api<{ accessToken: string }>(
        "/auth/login",
        { method: "POST", body: JSON.stringify({ email, password }) },
      );
      setSession(res.accessToken);
      router.replace(safeNext());
    } catch (err) {
      setError(
        err instanceof ApiError && err.status === 401
          ? "Invalid email or password."
          : "Something went wrong. Try again.",
      );
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
          <span className="text-section font-semibold text-ink2">
            SuperSaaS
          </span>
        </div>
        <h1 className="mb-1 text-title font-semibold text-ink2">Log in</h1>
        <p className="mb-6 text-sm text-muted">
          Welcome back. Enter your details.
        </p>

        <form onSubmit={onSubmit} className="space-y-4">
          <label className="block">
            <span className="mb-1 block text-sm font-medium text-ink">
              Email
            </span>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded border border-line-mid bg-surface px-3 py-2 text-base outline-none focus:border-accent focus:ring-2 focus:ring-accent-soft2"
              placeholder="you@company.com"
            />
          </label>
          <label className="block">
            <span className="mb-1 flex items-center justify-between text-sm font-medium text-ink">
              Password
              <Link
                href="/forgot-password"
                className="text-tiny font-normal text-muted hover:text-accent"
              >
                Forgot password?
              </Link>
            </span>
            <input
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded border border-line-mid bg-surface px-3 py-2 text-base outline-none focus:border-accent focus:ring-2 focus:ring-accent-soft2"
              placeholder="••••••••"
            />
          </label>

          {error && (
            <p className="rounded bg-danger-bg px-3 py-2 text-sm text-danger-text">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={busy}
            className="w-full rounded bg-accent px-3 py-2 text-base font-medium text-white transition-colors hover:bg-accent-hover disabled:opacity-60"
          >
            {busy ? "Logging in…" : "Log in"}
          </button>
        </form>

        <p className="mt-6 text-sm text-muted">
          No account?{" "}
          <Link href="/signup" className="font-medium text-accent">
            Sign up
          </Link>
        </p>
      </div>
    </main>
  );
}
