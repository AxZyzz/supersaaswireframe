"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, RotateCw, X } from "lucide-react";
import { ApiError, errorMessage } from "@/lib/api";

type Toast = { id: number; kind: "error" | "success"; text: string };

/** Show a transient message from anywhere (e.g. after a save). */
export function toast(text: string, kind: Toast["kind"] = "success") {
  window.dispatchEvent(new CustomEvent("app-toast", { detail: { text, kind } }));
}

/**
 * Bottom-right toasts. Also the safety net for fire-and-forget handlers
 * (`onClick={() => void doThing()}`): an API failure nobody caught surfaces as
 * an error toast with the server's message instead of failing silently.
 */
export function Toaster() {
  const [toasts, setToasts] = useState<Toast[]>([]);

  useEffect(() => {
    let seq = 0;
    const push = (kind: Toast["kind"], text: string) => {
      const id = ++seq;
      setToasts((t) => [...t.slice(-2), { id, kind, text }]);
      setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 5000);
    };
    const onToast = (e: Event) => {
      const d = (e as CustomEvent<{ text: string; kind: Toast["kind"] }>).detail;
      push(d.kind, d.text);
    };
    const onRejection = (e: PromiseRejectionEvent) => {
      // Only API failures — genuine bugs should still reach the console.
      if (!(e.reason instanceof ApiError)) return;
      e.preventDefault();
      // 401s are handled by the auth redirect; don't double-report.
      if (e.reason.status === 401) return;
      push("error", errorMessage(e.reason, "That didn't work. Please try again."));
    };
    window.addEventListener("app-toast", onToast);
    window.addEventListener("unhandledrejection", onRejection);
    return () => {
      window.removeEventListener("app-toast", onToast);
      window.removeEventListener("unhandledrejection", onRejection);
    };
  }, []);

  return (
    <div
      className="pointer-events-none fixed right-4 bottom-4 z-50 flex w-80 max-w-[calc(100vw-2rem)] flex-col gap-2"
      aria-live="polite"
    >
      {toasts.map((t) => (
        <div
          key={t.id}
          className="pointer-events-auto flex items-start gap-2 rounded-lg border border-line bg-white p-3 text-sm shadow-float"
        >
          {t.kind === "error" ? (
            <AlertTriangle size={16} className="mt-0.5 shrink-0 text-danger-text" />
          ) : (
            <CheckCircle2 size={16} className="mt-0.5 shrink-0 text-success-text" />
          )}
          <p className="flex-1 text-ink">{t.text}</p>
          <button
            onClick={() => setToasts((x) => x.filter((y) => y.id !== t.id))}
            className="text-faint hover:text-ink"
            aria-label="Dismiss"
          >
            <X size={14} />
          </button>
        </div>
      ))}
    </div>
  );
}

/** Inline failure state for a section or page that couldn't load. */
export function LoadError({
  message,
  onRetry,
}: {
  message: string;
  onRetry?: () => void;
}) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-lg border border-line bg-white px-4 py-10 text-center">
      <AlertTriangle size={20} className="text-danger-text" />
      <p className="text-sm text-ink">{message}</p>
      {onRetry && (
        <button
          onClick={onRetry}
          className="mt-1 flex items-center gap-1.5 rounded border border-line-mid px-3 py-1.5 text-sm text-ink hover:bg-hover"
        >
          <RotateCw size={13} /> Try again
        </button>
      )}
    </div>
  );
}

export const loadErrorText = (e: unknown) =>
  errorMessage(e, "Couldn't load this. Check your connection and try again.");
