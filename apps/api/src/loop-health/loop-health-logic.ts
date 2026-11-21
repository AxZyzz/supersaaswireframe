/**
 * Learning Loop T13: the pure rules of "loop health": what to count, and when
 * a count is bad. No database here; the service gathers the numbers and these
 * functions decide what is wrong, so unit tests can pin every threshold.
 *
 * Why it matters: the whole loop (test, learn, test again) only works if the
 * data feeding it is sound. A broken outcome feed or a skewed split quietly
 * makes every Review wrong, so these counts are shown on the Review screen and
 * written to the logs, where alerts watch them.
 */

/** Outcome coverage below this is red (Aman's default 90%). */
export const COVERAGE_BAD = 0.9;
/** A review action requested/approved but not applied for this long is stuck. */
export const STUCK_ACTION_MINUTES = 10;
/** Sample-ratio mismatch p-value below this is red (same bar the Review gate uses). */
export const SRM_P_BAD = 0.001;
/** Discovery fills less than this share of its reserved slots on average: amber. */
export const ALLOCATION_FILL_WARN = 0.5;
/** A preference ending within this many hours is flagged. */
export const PREFERENCE_EXPIRY_WARN_HOURS = 48;

export interface ExperimentHealth {
  experimentId: string;
  campaignId: string;
  campaignName: string;
  /** Companies assigned to each version. */
  assigned: { variantId: string; label: string; companies: number }[];
  /** Split-check p-value; null when it does not apply (a version is paused). */
  srmP: number | null;
  srmNote: string | null;
  /** Share of replying companies with a settled outcome; null with no replies yet. */
  coverage: number | null;
  replyingCompanies: number;
  /** Gates the latest review failed (ids such as outcome_coverage). */
  failedGates: string[];
}

export interface LoopHealth {
  generatedAt: string;
  experiments: ExperimentHealth[];
  /** Replies / outcomes we could not tie to an enrollment, last 7 days. */
  unattributed7d: number;
  /** How many running experiments failed each gate in their latest review. */
  gateFailures: Record<string, number>;
  /** Actions requested or approved but not applied for > 10 minutes. */
  stuckActions: number;
  /** Discover runs that used a preference: how much of the reserved share was found. */
  allocation: { runs: number; avgFill: number | null };
  /** Active preferences ending in under 48 hours. */
  preferencesExpiringSoon: { id: string; label: string; expiresAt: string }[];
}

export type Severity = 'bad' | 'warn' | 'info';

export interface Problem {
  id: string;
  severity: Severity;
  message: string;
  /** Where to go to look at it. */
  link: string | null;
}

export type HealthStatus = 'ok' | 'warn' | 'bad';

const pct = (v: number) => `${Math.round(v * 100)}%`;

/** What is wrong right now, worst first. */
export function buildProblems(h: LoopHealth): Problem[] {
  const out: Problem[] = [];

  for (const e of h.experiments) {
    if (e.coverage !== null && e.coverage < COVERAGE_BAD) {
      out.push({
        id: `coverage:${e.experimentId}`,
        severity: 'bad',
        message: `${e.campaignName}: only ${pct(e.coverage)} of replying companies have a settled outcome (need ${pct(COVERAGE_BAD)}). Confirm or reject the waiting replies.`,
        link: '/review/outcomes',
      });
    }
    if (e.srmP !== null && e.srmP < SRM_P_BAD) {
      const split = e.assigned
        .map((a) => `${a.label} ${a.companies}`)
        .join(' / ');
      out.push({
        id: `srm:${e.experimentId}`,
        severity: 'bad',
        message: `${e.campaignName}: companies are not splitting between versions as planned (${split}, p = ${e.srmP.toFixed(4)}). The comparison may not be fair.`,
        link: '/campaigns',
      });
    }
  }

  if (h.stuckActions > 0) {
    out.push({
      id: 'stuck_actions',
      severity: 'bad',
      message: `${h.stuckActions} review action${h.stuckActions === 1 ? ' is' : 's are'} stuck: requested but not applied for over ${STUCK_ACTION_MINUTES} minutes.`,
      link: '/campaigns',
    });
  }

  if (h.unattributed7d > 0) {
    out.push({
      id: 'unattributed',
      severity: 'warn',
      message: `${h.unattributed7d} repl${h.unattributed7d === 1 ? 'y' : 'ies'} in the last 7 days could not be tied to a campaign, so no test counts them.`,
      link: '/review/outcomes',
    });
  }

  if (
    h.allocation.avgFill !== null &&
    h.allocation.avgFill < ALLOCATION_FILL_WARN
  ) {
    out.push({
      id: 'allocation',
      severity: 'warn',
      message: `Discover finds only ${pct(h.allocation.avgFill)} of the slots reserved by the search preference (last ${h.allocation.runs} searches). The rest comes from the normal search.`,
      link: '/discover',
    });
  }

  for (const p of h.preferencesExpiringSoon) {
    out.push({
      id: `preference_expiring:${p.id}`,
      severity: 'info',
      message: `Search preference "${p.label}" ends on ${new Date(p.expiresAt).toLocaleDateString('en-GB')}.`,
      link: '/discover',
    });
  }

  const rank: Record<Severity, number> = { bad: 0, warn: 1, info: 2 };
  return out.sort((a, b) => rank[a.severity] - rank[b.severity]);
}

export function overallStatus(problems: Problem[]): HealthStatus {
  if (problems.some((p) => p.severity === 'bad')) return 'bad';
  if (problems.some((p) => p.severity === 'warn')) return 'warn';
  return 'ok';
}

/** "2026-W47": the ISO week (Monday start) a date falls in, in UTC. */
export function isoWeek(now: Date): string {
  const d = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const yearStart = Date.UTC(d.getUTCFullYear(), 0, 1);
  const week = Math.ceil(((d.getTime() - yearStart) / 86_400_000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

/**
 * The structured line alerts read. Cloud Run turns one JSON line on stdout
 * into a Cloud Logging entry, and the log-based metrics count these fields.
 */
export function loopHealthLogLine(
  orgId: string,
  h: LoopHealth,
  problems: Problem[],
): string {
  const coverages = h.experiments
    .map((e) => e.coverage)
    .filter((c): c is number => c !== null);
  const status = overallStatus(problems);
  return JSON.stringify({
    severity: status === 'bad' ? 'WARNING' : 'INFO',
    event: 'loop_health',
    org_id: orgId,
    status,
    experiments_running: h.experiments.length,
    coverage_min: coverages.length ? Math.min(...coverages) : null,
    srm_breaches: h.experiments.filter(
      (e) => e.srmP !== null && e.srmP < SRM_P_BAD,
    ).length,
    stuck_actions: h.stuckActions,
    unattributed_7d: h.unattributed7d,
    gate_failures: h.gateFailures,
    gate_failures_total: Object.values(h.gateFailures).reduce(
      (a, b) => a + b,
      0,
    ),
    allocation_fill: h.allocation.avgFill,
    preferences_expiring_48h: h.preferencesExpiringSoon.length,
  });
}
