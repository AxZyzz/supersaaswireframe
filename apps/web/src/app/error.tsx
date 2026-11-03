"use client";

import Link from "next/link";
import { useEffect } from "react";
import { AlertTriangle } from "lucide-react";

/** Last-resort boundary: a render crash shows this instead of a blank page. */
export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error); // Sentry hooks in here once T10.5 lands
  }, [error]);

  return (
    <main className="flex min-h-screen items-center justify-center bg-page px-4">
      <div className="w-full max-w-sm rounded-lg border border-line bg-surface p-6 text-center">
        <AlertTriangle size={24} className="mx-auto text-danger-text" />
        <h1 className="mt-3 text-title font-semibold text-ink2">Something broke</h1>
        <p className="mt-1.5 text-sm text-muted">
          An unexpected error stopped this page from loading. Your data is safe.
        </p>
        {error.digest && (
          <p className="mt-2 text-tiny text-faint">Reference: {error.digest}</p>
        )}
        <div className="mt-5 flex justify-center gap-2">
          <button
            onClick={reset}
            className="rounded bg-accent px-4 py-1.5 text-sm font-medium text-white hover:bg-accent-hover"
          >
            Try again
          </button>
          <Link
            href="/dashboard"
            className="rounded border border-line-mid px-4 py-1.5 text-sm text-ink hover:bg-hover"
          >
            Dashboard
          </Link>
        </div>
      </div>
    </main>
  );
}
