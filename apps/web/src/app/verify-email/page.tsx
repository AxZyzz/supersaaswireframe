"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { api, errorMessage, setSession } from "@/lib/api";
import { AuthCard } from "@/components/auth-card";

const noopSubscribe = () => () => {};

/** Opened from the confirmation email: confirms the address and signs in. */
export default function VerifyEmailPage() {
  const router = useRouter();
  const token = useSyncExternalStore(
    noopSubscribe,
    () => new URLSearchParams(window.location.search).get("token") ?? "",
    () => null,
  );
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false);

  useEffect(() => {
    if (!token || started.current) return;
    started.current = true; // the link is single-use: never post it twice
    api<{ accessToken: string }>("/auth/verify-email", {
      method: "POST",
      body: JSON.stringify({ token }),
    })
      .then((res) => {
        setSession(res.accessToken);
        router.replace("/dashboard");
      })
      .catch((e) =>
        setError(errorMessage(e, "Something went wrong. Try the link again.")),
      );
  }, [token, router]);

  if (token === null) return null;

  if (!token || error) {
    return (
      <AuthCard
        title="Couldn't confirm your email"
        subtitle={
          error ??
          "This link is missing its code. Open the link from the email again."
        }
      >
        <p className="text-sm text-muted">
          Log in with your email and password: if your email still needs
          confirming, you can send yourself a new link from there.
        </p>
        <Link href="/login" className="mt-4 inline-block text-sm font-medium text-accent">
          Go to log in
        </Link>
      </AuthCard>
    );
  }

  return (
    <AuthCard title="Confirming your email…" subtitle="One moment, signing you in.">
      <div className="h-1 w-full overflow-hidden rounded bg-panel">
        <div className="h-full w-1/3 animate-pulse rounded bg-accent" />
      </div>
    </AuthCard>
  );
}
