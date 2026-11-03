"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { MailCheck, XCircle } from "lucide-react";
import {
  clearSession,
  errorMessage,
  hasSessionHint,
  setSession,
} from "@/lib/api";
import {
  acceptInvite,
  InvitePreview,
  previewInvite,
  registerInvite,
  ROLE_META,
} from "@/lib/team";

const field =
  "w-full rounded border border-line-mid bg-white px-3 py-2 text-base outline-none focus:border-accent focus:ring-2 focus:ring-accent-soft2";

export default function InvitePage() {
  const { token } = useParams<{ token: string }>();
  const router = useRouter();
  const [inv, setInv] = useState<InvitePreview | null>(null);
  const [missing, setMissing] = useState(false);
  const [signedIn, setSignedIn] = useState(false);
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    setSignedIn(hasSessionHint());
    previewInvite(token)
      .then(setInv)
      .catch(() => setMissing(true));
  }, [token]);

  async function finish(fn: () => Promise<{ accessToken: string }>) {
    setBusy(true);
    setErr(null);
    try {
      const t = await fn();
      setSession(t.accessToken);
      router.replace("/dashboard");
    } catch (e) {
      setErr(errorMessage(e));
      setBusy(false);
    }
  }

  function switchAccount() {
    clearSession();
    router.push(`/login?next=${encodeURIComponent(`/invite/${token}`)}`);
  }

  const shell = (children: React.ReactNode) => (
    <main className="flex min-h-screen items-center justify-center bg-page px-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded bg-accent text-tiny font-semibold text-white">
            SS
          </div>
          <span className="text-section font-semibold text-ink2">SuperSaaS</span>
        </div>
        {children}
      </div>
    </main>
  );

  if (missing || (inv && inv.status !== "pending")) {
    return shell(
      <div className="rounded-lg border border-line bg-white p-6">
        <XCircle size={22} className="text-danger-text" />
        <h1 className="mt-3 text-title font-semibold text-ink2">
          {inv?.status === "accepted"
            ? "Invite already used"
            : inv?.status === "expired"
              ? "Invite expired"
              : "Invite not found"}
        </h1>
        <p className="mt-1.5 text-sm text-muted">
          {inv?.status === "accepted"
            ? "This link has already been used to join. Log in to continue."
            : "Ask a workspace admin to send you a fresh invite link."}
        </p>
        <Link href="/login" className="mt-5 inline-block text-sm font-medium text-accent">
          Go to log in
        </Link>
      </div>,
    );
  }

  if (!inv) {
    return (
      <div className="flex h-screen items-center justify-center bg-page text-sm text-muted">
        Opening invite…
      </div>
    );
  }

  return shell(
    <>
      <div className="mb-6 rounded-lg border border-line bg-white p-4">
        <MailCheck size={20} className="text-accent" />
        <h1 className="mt-2 text-title font-semibold text-ink2">
          Join {inv.orgName}
        </h1>
        <p className="mt-1 text-sm text-muted">
          You&apos;ve been invited as{" "}
          <span className="font-medium text-ink">{ROLE_META[inv.role].label}</span>{" "}
          — {ROLE_META[inv.role].desc.toLowerCase()}.
        </p>
      </div>

      {signedIn ? (
        <div className="space-y-3">
          <p className="text-sm text-muted">
            This invite is for <span className="font-medium text-ink">{inv.email}</span>.
          </p>
          <button
            onClick={() => void finish(() => acceptInvite(token))}
            disabled={busy}
            className="w-full rounded bg-accent px-3 py-2 text-base font-medium text-white hover:bg-accent-hover disabled:opacity-60"
          >
            {busy ? "Joining…" : `Join ${inv.orgName}`}
          </button>
          {err && (
            <p className="rounded bg-danger-bg px-3 py-2 text-sm text-danger-text">{err}</p>
          )}
          <button onClick={switchAccount} className="text-sm text-muted hover:text-ink">
            Use a different account
          </button>
        </div>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void finish(() => registerInvite(token, name, password));
          }}
          className="space-y-4"
        >
          <label className="block">
            <span className="mb-1 block text-sm font-medium text-ink">Email</span>
            <input value={inv.email} disabled className={`${field} bg-panel text-muted`} />
          </label>
          <label className="block">
            <span className="mb-1 block text-sm font-medium text-ink">Your name</span>
            <input
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              className={field}
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-sm font-medium text-ink">Password</span>
            <input
              type="password"
              required
              minLength={8}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className={field}
              placeholder="At least 8 characters"
            />
          </label>
          {err && (
            <p className="rounded bg-danger-bg px-3 py-2 text-sm text-danger-text">{err}</p>
          )}
          <button
            type="submit"
            disabled={busy}
            className="w-full rounded bg-accent px-3 py-2 text-base font-medium text-white hover:bg-accent-hover disabled:opacity-60"
          >
            {busy ? "Creating account…" : "Create account & join"}
          </button>
          <p className="text-sm text-muted">
            Already have an account?{" "}
            <Link
              href={`/login?next=${encodeURIComponent(`/invite/${token}`)}`}
              className="font-medium text-accent"
            >
              Log in to accept
            </Link>
          </p>
        </form>
      )}
    </>,
  );
}
