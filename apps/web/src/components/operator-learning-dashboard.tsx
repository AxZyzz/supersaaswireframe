"use client";

import { useEffect, useState } from "react";
import { ExternalLink, LayoutDashboard } from "lucide-react";
import { api } from "@/lib/api";

/**
 * Operator "Learning dashboard" card (T16): a link to the Looker Studio dashboard
 * built from docs/LOOKER-STUDIO.md. The address comes from the API's
 * LOOKER_DASHBOARD_URL setting, so it can change without a web rebuild.
 */
export function OperatorLearningDashboard() {
  const [url, setUrl] = useState<string | null | undefined>(undefined);

  useEffect(() => {
    let live = true;
    api<{ url: string | null }>("/operator/learning-dashboard")
      .then((d) => live && setUrl(d.url))
      .catch(() => live && setUrl(null));
    return () => {
      live = false;
    };
  }, []);

  if (url === undefined) return null;
  return (
    <section className="rounded-lg border border-line bg-surface p-4" data-testid="learning-dashboard">
      <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold text-ink2">
        <LayoutDashboard size={15} className="text-faint" /> Learning dashboard
      </h2>
      {url ? (
        <>
          <p className="text-sm text-muted">
            What works, where and when: the factor funnel, the send-time heatmap, review history and targeted vs
            baseline search. Demo workspace only.
          </p>
          <a
            href={url}
            target="_blank"
            rel="noreferrer"
            className="mt-3 inline-flex items-center gap-1.5 rounded bg-accent px-3 py-1.5 text-sm font-medium text-white hover:bg-accent-hover"
          >
            Open the dashboard <ExternalLink size={13} />
          </a>
        </>
      ) : (
        <p className="text-sm text-muted">
          Not set up yet. Build it with <code>docs/LOOKER-STUDIO.md</code>, then set <code>LOOKER_DASHBOARD_URL</code>{" "}
          on the API to its share link.
        </p>
      )}
    </section>
  );
}
