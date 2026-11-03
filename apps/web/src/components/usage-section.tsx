"use client";

import { useEffect, useState } from "react";
import { Gauge } from "lucide-react";
import { api } from "@/lib/api";
import { HelpLink } from "@/components/help-link";

interface UsageItem {
  key: string;
  label: string;
  used: number;
  limit: number | null;
}
interface Usage {
  plan: string;
  items: UsageItem[];
  stepsPerCampaign: number | null;
}

const PLAN_LABEL: Record<string, string> = {
  beta: "Public beta (free)",
  internal: "Internal (unlimited)",
};

/** Plan usage meters; turns amber at 80% and red at the cap. */
export function UsageSection() {
  const [u, setU] = useState<Usage | null>(null);
  useEffect(() => {
    void api<Usage>("/usage").then(setU);
  }, []);
  if (!u) return null;

  return (
    <section className="rounded-lg border border-line bg-surface p-5">
      <div className="mb-1 flex items-center gap-2">
        <Gauge size={16} className="text-faint" />
        <h2 className="text-section font-semibold text-ink2">Plan & usage</h2>
        <HelpLink slug="plan-limits" />
        <span className="rounded-full bg-accent-soft px-2 py-0.5 text-micro font-medium text-accent">
          {PLAN_LABEL[u.plan] ?? u.plan}
        </span>
      </div>
      <p className="mb-4 text-sm text-muted">
        What your workspace has used against its plan. Daily email counts reset at
        midnight UTC, monthly ones on the 1st.
        {u.stepsPerCampaign !== null && ` Campaigns can have up to ${u.stepsPerCampaign} steps.`}
      </p>
      <div className="grid gap-x-8 gap-y-4 sm:grid-cols-2">
        {u.items.map((i) => {
          const pct = i.limit ? Math.min(100, (i.used / i.limit) * 100) : 0;
          const tone =
            i.limit === null
              ? "bg-accent"
              : pct >= 100
                ? "bg-danger-text"
                : pct >= 80
                  ? "bg-warning-text"
                  : "bg-accent";
          return (
            <div key={i.key}>
              <div className="mb-1 flex items-baseline justify-between gap-2 text-sm">
                <span className="text-ink first-letter:uppercase">{i.label}</span>
                <span className="shrink-0 text-tiny text-muted">
                  {i.used.toLocaleString()}
                  {i.limit === null ? " · unlimited" : ` / ${i.limit.toLocaleString()}`}
                </span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-hover">
                <div
                  className={`h-full rounded-full ${tone}`}
                  style={{ width: `${i.limit === null ? 0 : pct}%` }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
