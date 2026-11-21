// Route decisions: one structured JSON line per AI call (Cloud Run turns a
// JSON line on stdout into a Cloud Logging entry) + an in-memory ring of the
// last 500 for the operator "AI routing" card. The ring is per instance.
export type RouteReason =
  'policy' | 'fallback_timeout' | 'circuit_open' | 'budget_downgrade';

export interface RouteRecord {
  at: string;
  kind: 'route' | 'circuit_open';
  task: string;
  model: string | null;
  reason: RouteReason | null;
  attempt: number;
  latencyMs: number;
  tokens: number;
  ok: boolean;
}

export type LogSink = (line: string) => void;

const RING_SIZE = 500;

export interface RouteSummaryRow {
  task: string;
  model: string | null;
  calls: number;
  fallbacks: number;
  budgetDowngrades: number;
  circuitSkips: number;
  failures: number;
  tokens: number;
}

export class RouteLog {
  private ring: RouteRecord[] = [];

  constructor(private sink: LogSink = (l) => process.stdout.write(`${l}\n`)) {}

  setSink(sink: LogSink) {
    this.sink = sink;
  }

  record(r: RouteRecord) {
    this.ring.push(r);
    if (this.ring.length > RING_SIZE) this.ring.shift();
    if (r.kind === 'route') {
      this.sink(
        JSON.stringify({
          severity: r.ok ? 'INFO' : 'WARNING',
          event: 'ai_route',
          task: r.task,
          chosen_model: r.model,
          reason: r.reason,
          attempt: r.attempt,
          latency_ms: r.latencyMs,
          tokens: r.tokens,
          ...(r.ok ? {} : { error: true }),
        }),
      );
    } else {
      this.sink(
        JSON.stringify({
          severity: 'WARNING',
          event: 'ai_circuit_open',
          model: r.model,
          task: r.task,
        }),
      );
    }
  }

  recent(): RouteRecord[] {
    return [...this.ring];
  }

  clear() {
    this.ring = [];
  }

  /** Last-24h roll-up used by the operator card. */
  summary(sinceMs = 24 * 3600 * 1000, now = Date.now()) {
    const cut = now - sinceMs;
    const rows = new Map<string, RouteSummaryRow>();
    const circuitEvents: { at: string; model: string | null }[] = [];
    for (const r of this.ring) {
      if (Date.parse(r.at) < cut) continue;
      if (r.kind === 'circuit_open') {
        circuitEvents.push({ at: r.at, model: r.model });
        continue;
      }
      const key = `${r.task}|${r.model}`;
      const row = rows.get(key) ?? {
        task: r.task,
        model: r.model,
        calls: 0,
        fallbacks: 0,
        budgetDowngrades: 0,
        circuitSkips: 0,
        failures: 0,
        tokens: 0,
      };
      row.calls += 1;
      row.tokens += r.tokens;
      if (r.reason === 'fallback_timeout') row.fallbacks += 1;
      if (r.reason === 'budget_downgrade') row.budgetDowngrades += 1;
      if (r.reason === 'circuit_open') row.circuitSkips += 1;
      if (!r.ok) row.failures += 1;
      rows.set(key, row);
    }
    return { routes: [...rows.values()], circuitEvents };
  }
}
