"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { api, ApiError, errorMessage, setTokens } from "@/lib/api";
import { WaitlistForm } from "@/components/waitlist-form";

export default function SignupPage() {
  const router = useRouter();
  const [form, setForm] = useState({
    name: "",
    orgName: "",
    email: "",
    password: "",
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Invite-only beta: ?code=… comes from the operator's invite link.
  const [mode, setMode] = useState<"open" | "waitlist" | null>(null);
  const [code, setCode] = useState<string | null>(null);

  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    setCode(p.get("code"));
    const invited = p.get("email");
    if (invited) setForm((f) => ({ ...f, email: invited }));
    api<{ mode: "open" | "waitlist" }>("/beta/mode")
      .then((r) => setMode(r.mode))
      .catch(() => setMode("open"));
  }, []);

  function set<K extends keyof typeof form>(key: K, value: string) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await api<{ accessToken: string; refreshToken: string }>(
        "/auth/signup",
        {
          method: "POST",
          body: JSON.stringify({ ...form, inviteCode: code ?? undefined }),
        },
      );
      setTokens(res.accessToken, res.refreshToken);
      router.replace("/dashboard");
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        setError("That email is already registered.");
      } else if (err instanceof ApiError && err.status === 403) {
        setError(errorMessage(err));
      } else if (err instanceof ApiError && err.status === 400) {
        setError("Check your details — password needs at least 8 characters.");
      } else {
        setError("Something went wrong. Try again.");
      }
      setBusy(false);
    }
  }

  const field =
    "w-full rounded border border-line-mid bg-white px-3 py-2 text-base outline-none focus:border-accent focus:ring-2 focus:ring-accent-soft2";

  if (mode === "waitlist" && !code) return <WaitlistForm />;

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
        <h1 className="mb-1 text-title font-semibold text-ink2">
          Create your workspace
        </h1>
        <p className="mb-6 text-sm text-muted">
          Start sending smarter outreach in minutes.
        </p>

        <form onSubmit={onSubmit} className="space-y-4">
          <label className="block">
            <span className="mb-1 block text-sm font-medium text-ink">
              Your name
            </span>
            <input
              required
              value={form.name}
              onChange={(e) => set("name", e.target.value)}
              className={field}
              placeholder="Aman"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-sm font-medium text-ink">
              Workspace name
            </span>
            <input
              required
              value={form.orgName}
              onChange={(e) => set("orgName", e.target.value)}
              className={field}
              placeholder="Acme Outreach"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-sm font-medium text-ink">
              Email
            </span>
            <input
              type="email"
              required
              value={form.email}
              onChange={(e) => set("email", e.target.value)}
              className={field}
              placeholder="you@company.com"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-sm font-medium text-ink">
              Password
            </span>
            <input
              type="password"
              required
              minLength={8}
              value={form.password}
              onChange={(e) => set("password", e.target.value)}
              className={field}
              placeholder="At least 8 characters"
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
            {busy ? "Creating…" : "Create workspace"}
          </button>
          <p className="text-tiny text-muted">
            By creating a workspace you agree to the{" "}
            <Link href="/terms" className="text-accent hover:underline">
              Terms
            </Link>{" "}
            and{" "}
            <Link href="/privacy" className="text-accent hover:underline">
              Privacy policy
            </Link>
            .
          </p>
        </form>

        <p className="mt-6 text-sm text-muted">
          Already have an account?{" "}
          <Link href="/login" className="font-medium text-accent">
            Log in
          </Link>
        </p>
      </div>
    </main>
  );
}
