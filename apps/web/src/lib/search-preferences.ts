import { api } from './api';

/** Learning Loop T12: "find more of who replies": capped, expiring, reversible. */

export type PrefFactor =
  'city' | 'region' | 'country' | 'industry' | 'size_band' | 'trigger';

export interface PrefEvidence {
  insightId: string;
  metric: string;
  x: number;
  n: number;
  p: number;
  lo: number;
  hi: number;
  overallP: number;
  sentence: string;
  confounding: string | null;
  computedAt: string;
  from: string | null;
  to: string | null;
  source: string;
}

export interface Proposal {
  proposalHash: string;
  offerId: string;
  factor: PrefFactor;
  value: string;
  label: string;
  filter: { factor: PrefFactor; value: string };
  mode: 'quota';
  capShare: number;
  expiresInDays: number;
  expiresAt: string;
  example: { batch12: number; batch20: number };
  evidence: PrefEvidence;
  staysTheSame: string[];
  warnings: { code: string; message: string; preferenceId?: string }[];
  weakMatch: boolean;
}

export interface SearchPreference {
  id: string;
  offerId: string;
  factor: PrefFactor;
  value: string;
  label: string;
  mode: string;
  capShare: number;
  startsAt: string;
  expiresAt: string;
  status: 'active' | 'expired' | 'withdrawn' | 'reverted' | 'deactivated';
  revision: number;
  endedAt: string | null;
  endedReason: string | null;
  evidence: PrefEvidence;
  approvedBy: { id: string; name: string } | null;
  createdAt: string;
  replayed?: boolean;
}

export interface PrefRevision {
  revision: number;
  action: string;
  reason: string | null;
  created_at: string;
  actor_name: string | null;
  after: { priorProfileRestored?: boolean; note?: string } | null;
}

export interface PrefDetail extends SearchPreference {
  revisions: PrefRevision[];
  runs: {
    id: string;
    goal: string;
    status: string;
    requested: number;
    verified: number;
    allocation: { skipped?: string } | null;
    created_at: string;
  }[];
}

export interface ArmStats {
  discovered: number;
  contactable: number;
  sent: number;
  reached: number;
  bounced: number;
  qualified: number;
  positive: number;
  qualifiedPerRun: number | null;
}

export interface PrefResults {
  preferenceId: string;
  label: string;
  status: string;
  runs: number;
  targeted: ArmStats;
  baseline: ArmStats;
  windowOpen: boolean;
  verdict: {
    state: 'keep_collecting' | 'test_next_batch' | 'apply_temporary' | 'revert';
    reasons: string[];
    qualifiedPerReached: { targeted: number | null; baseline: number | null };
    diff: { d: number; lo: number; hi: number } | null;
    coverage: number | null;
  };
  note: string;
}

export interface InsightRef {
  offerId?: string;
  insightId: string;
  campaignIds?: string[];
  from?: string;
  to?: string;
}

const post = <T>(path: string, body?: unknown) =>
  api<T>(path, { method: 'POST', body: JSON.stringify(body ?? {}) });

export const proposePreference = (ref: InsightRef) =>
  post<Proposal>('/search-preferences/propose', ref);

export const createPreference = (
  ref: InsightRef,
  body: {
    proposalHash: string;
    idempotencyKey: string;
    capShare?: number;
    expiresInDays?: number;
  },
) => post<SearchPreference>('/search-preferences', { ...ref, ...body });

export const listPreferences = (offerId?: string) =>
  api<SearchPreference[]>(
    `/search-preferences${offerId ? `?offerId=${offerId}` : ''}`,
  );

export const getPreference = (id: string) =>
  api<PrefDetail>(`/search-preferences/${id}`);

export const getPreferenceResults = (id: string) =>
  api<PrefResults>(`/search-preferences/${id}/results`);

export const withdrawPreference = (id: string, reason?: string) =>
  post<SearchPreference>(`/search-preferences/${id}/withdraw`, { reason });

export const revertPreference = (id: string, reason?: string) =>
  post<SearchPreference>(`/search-preferences/${id}/revert`, { reason });

export const STATE_LABEL: Record<PrefResults['verdict']['state'], string> = {
  keep_collecting: 'Keep collecting',
  test_next_batch: 'Test next batch',
  apply_temporary: 'Extend the test',
  revert: 'Revert',
};

/** "12 days 4 hours" / "3 hours" / "less than an hour". */
export function countdown(expiresAt: string, now = Date.now()): string {
  const ms = new Date(expiresAt).getTime() - now;
  if (ms <= 0) return 'expired';
  const hours = Math.floor(ms / 3_600_000);
  const d = Math.floor(hours / 24);
  const h = hours % 24;
  if (d > 0) return `${d} day${d === 1 ? '' : 's'}${h ? ` ${h} h` : ''}`;
  if (hours > 0) return `${hours} hour${hours === 1 ? '' : 's'}`;
  return 'less than an hour';
}

/** 0.035 -> "+3.5"; -0.006 -> "−0.6" (a real minus sign). */
export const pctPoints = (v: number) =>
  `${v < 0 ? '−' : '+'}${Math.abs(v * 100).toFixed(1)}`;
