import { api } from "./api";

/** Learning Loop T06: what works, factor by factor. Exploratory, never a decision. */
export type Metric = "reply" | "positive" | "qualified" | "booked" | "open";

export const METRIC_LABEL: Record<Metric, string> = {
  reply: "Replies",
  positive: "Interested",
  qualified: "Confirmed qualified",
  booked: "Booked calls",
  open: "Opens (diagnostic)",
};

export interface Rate {
  x: number;
  n: number;
  p: number | null;
  lo: number;
  hi: number;
}

export interface BucketStat extends Rate {
  bucket: string;
  status: "best" | "worst" | "neutral" | "thin";
  medianHoursToReply: number | null;
  bounceRate: number | null;
  unsubscribeRate: number | null;
  discovered: number;
  eligible: number;
  sent: number;
}

export interface FactorEval {
  factor: string;
  metric: Metric;
  overall: Rate;
  buckets: BucketStat[];
  thin: BucketStat[];
  verdict: "leader" | "no_clear_leader" | "not_enough_data";
  best: BucketStat | null;
  worst: BucketStat | null;
  topGrey: BucketStat | null;
}

export interface BucketRow {
  factor: string;
  bucket: string;
  sent: number;
  reached: number;
  bounced: number;
  opened: number;
  replied: number;
  positive: number;
  qualified: number;
  booked: number;
  unsubscribed: number;
  medianHoursToReply: number | null;
  discovered: number;
  eligible: number;
}

export interface FactorDef {
  id: string;
  label: string;
  group: "audience" | "send" | "sequence";
  searchable: boolean;
  funnel: boolean;
  kind: "rate" | "distribution";
}

export interface FactorView {
  def: FactorDef;
  evals: Partial<Record<Metric, FactorEval>>;
  rows: BucketRow[];
  comparable: boolean;
}

export interface Insight {
  id: string;
  factor: string;
  factorLabel: string;
  metric: Metric;
  bucket: string;
  sentence: string;
  x: number;
  n: number;
  p: number;
  lo: number;
  hi: number;
  overallP: number;
  exploratory: string;
  confounding: string | null;
  searchable: boolean;
  diagnostic: boolean;
}

export interface GridRow {
  day: number;
  block: number;
  reached: number;
  replied: number;
  qualified: number;
}

export interface InsightsResponse {
  source: string;
  /** BigQuery only: newest change from this workspace that has reached BigQuery (ISO), else null. */
  dataAsOf: string | null;
  generatedAt: string;
  cached: boolean;
  totals: BucketRow;
  headlineMetric: Metric;
  headlines: Insight[];
  headlinesByMetric: Record<Metric, Insight[]>;
  diagnostics: Insight[];
  factors: FactorView[];
  stars: { warn: boolean; message: string | null };
  sendTime: {
    status: { comparable: boolean; message: string | null };
    grid: GridRow[];
    overallReplyRate: number | null;
  };
  timezone: { recipient: number; workspace: number; workspaceZone: string };
  coverage: { positive: number; qualified: number; ratio: number | null };
  note: string;
}

export interface InsightsFilters {
  offerId?: string;
  campaignId?: string;
  from?: string;
  to?: string;
}

export const getInsights = (f: InsightsFilters) => {
  const q = new URLSearchParams();
  if (f.offerId) q.set("offerId", f.offerId);
  if (f.campaignId) q.set("campaignId", f.campaignId);
  if (f.from) q.set("from", f.from);
  if (f.to) q.set("to", f.to);
  const s = q.toString();
  return api<InsightsResponse>(`/insights${s ? `?${s}` : ""}`);
};

export const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
export const BLOCKS = ["6-8", "8-10", "10-12", "12-2", "2-4", "4-6", "6-8 pm", "8-10 pm"];

export const pct = (v: number | null | undefined, digits = 1) =>
  v === null || v === undefined ? "–" : `${(v * 100).toFixed(digits)}%`;

export const pretty = (v: string) => v.replace(/_/g, " ");
