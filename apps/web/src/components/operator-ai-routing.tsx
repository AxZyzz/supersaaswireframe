"use client";

import { useEffect, useState } from "react";
import { Route } from "lucide-react";
import { api } from "@/lib/api";

interface UsageRow {
  task: string;
  provider: string;
  model: string;
  calls: number;
  tokens: number;
}
interface LiveRow {
  task: string;
  model: string | null;
  calls: number;
  fallbacks: number;
  budgetDowngrades: number;
  circuitSkips: number;
  failures: number;
  tokens: number;
}
interface Routing {
  usage: UsageRow[];
  live: { routes: LiveRow[]; circuitEvents: { at: string; model: string | null }[] };
  liveScope: string;
}

/** Operator "AI routing" card (T08): which model answered each task, last 24 h. */
export function OperatorAiRouting() {
  const [data, setData] = useState<Routing | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let live = true;
    api<Routing>("/operator/ai-routing")
      .then((d) => live && setData(d))
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, []);

  return (
    <section className="rounded-lg border border-line bg-surface p-4" data-testid="ai-routing">
      <h2 className="mb-1 flex items-center gap-2 text-sm font-semibold text-ink2">
        <Route size={15} className="text-faint" /> AI routing (last 24 h)
      </h2>
      <p className="mb-3 text-tiny text-muted">
        Which model answered each task. Calls and tokens cover every instance. Fallbacks and
        circuit events cover only the API instance you reached.
      </p>
      {failed ? (
        <p className="text-sm text-muted">Couldn&apos;t load AI routing.</p>
      ) : !data ? (
        <p className="text-sm text-muted">Loading…</p>
      ) : (
        <div className="space-y-4">
          {data.usage.length === 0 ? (
            <p className="text-sm text-muted">No AI calls in the last 24 hours.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-tiny uppercase text-faint">
                  <tr>
                    <th className="py-1 pr-3">Task</th>
                    <th className="py-1 pr-3">Model</th>
                    <th className="py-1 pr-3 text-right">Calls</th>
                    <th className="py-1 text-right">Tokens</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {data.usage.map((u, i) => (
                    <tr key={i}>
                      <td className="py-1.5 pr-3 text-ink">{u.task}</td>
                      <td className="py-1.5 pr-3 text-muted">{u.model}</td>
                      <td className="py-1.5 pr-3 text-right tabular-nums">{u.calls}</td>
                      <td className="py-1.5 text-right tabular-nums">
                        {u.tokens.toLocaleString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div>
            <h3 className="mb-1 text-tiny font-medium uppercase text-faint">
              Fallbacks, downgrades and circuit events ({data.liveScope})
            </h3>
            {data.live.routes.every(
              (r) => !r.fallbacks && !r.budgetDowngrades && !r.circuitSkips && !r.failures,
            ) && data.live.circuitEvents.length === 0 ? (
              <p className="text-sm text-muted">None: every call used its first-choice model.</p>
            ) : (
              <ul className="space-y-1 text-sm">
                {data.live.routes
                  .filter((r) => r.fallbacks || r.budgetDowngrades || r.circuitSkips || r.failures)
                  .map((r, i) => (
                    <li key={i} className="text-ink">
                      {r.task} → {r.model ?? "provider default"}: {r.fallbacks} fallback
                      {r.fallbacks === 1 ? "" : "s"}, {r.circuitSkips} circuit skip
                      {r.circuitSkips === 1 ? "" : "s"}, {r.budgetDowngrades} budget downgrade
                      {r.budgetDowngrades === 1 ? "" : "s"}, {r.failures} failed
                    </li>
                  ))}
                {data.live.circuitEvents.map((c, i) => (
                  <li key={`c${i}`} className="text-danger-text">
                    Circuit opened for {c.model ?? "unknown"} at{" "}
                    {new Date(c.at).toLocaleTimeString()}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
