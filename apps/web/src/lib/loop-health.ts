import { api } from './api';

/** Learning Loop T13: is the data feeding the learning loop sound? */

export type HealthStatus = 'ok' | 'warn' | 'bad';

export interface HealthProblem {
  id: string;
  severity: 'bad' | 'warn' | 'info';
  message: string;
  link: string | null;
}

export interface ExperimentHealth {
  experimentId: string;
  campaignId: string;
  campaignName: string;
  assigned: { variantId: string; label: string; companies: number }[];
  srmP: number | null;
  srmNote: string | null;
  coverage: number | null;
  replyingCompanies: number;
  failedGates: string[];
}

export interface LoopHealth {
  generatedAt: string;
  status: HealthStatus;
  experiments: ExperimentHealth[];
  unattributed7d: number;
  gateFailures: Record<string, number>;
  stuckActions: number;
  allocation: { runs: number; avgFill: number | null };
  preferencesExpiringSoon: { id: string; label: string; expiresAt: string }[];
  problems: HealthProblem[];
}

export const getLoopHealth = () => api<LoopHealth>('/review/health');

export const pctOf = (v: number | null | undefined) =>
  v === null || v === undefined ? '–' : `${Math.round(v * 100)}%`;
