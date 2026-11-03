import { api } from "./api";

export interface Overview {
  leads: { total: number; new7: number };
  campaigns: { total: number; active: number };
  sent: { total: number; last7: number };
  engagement: {
    opened: number;
    clicked: number;
    replied: number;
    unsubscribed: number;
    bounced: number;
  };
  activity: { type: string; createdAt: string; lead: string }[];
  alerts: { kind: string; message: string }[];
}

export interface CampaignAnalyticsRow {
  id: string;
  name: string;
  status: string;
  enrolled: number;
  sent: number;
  opened: number;
  clicked: number;
  replied: number;
  unsubscribed: number;
}

export interface StepAnalyticsRow {
  step_order: number;
  template_name: string | null;
  delay_hours: number;
  condition: string;
  sent: number;
  opened: number;
  clicked: number;
  replied: number;
  variants: { index: number; subject: string; sent: number; opened: number }[];
}

/** Reporting window as ISO strings; `to` is exclusive. Empty = all time. */
export interface Range {
  from?: string;
  to?: string;
}

const qs = (r?: Range) => {
  const p = new URLSearchParams();
  if (r?.from) p.set("from", r.from);
  if (r?.to) p.set("to", r.to);
  const s = p.toString();
  return s ? `?${s}` : "";
};

export const getOverview = (r?: Range) => api<Overview>(`/analytics/overview${qs(r)}`);

export const getCampaignAnalytics = (r?: Range) =>
  api<CampaignAnalyticsRow[]>(`/analytics/campaigns${qs(r)}`);

export const getCampaignSteps = (id: string) =>
  api<StepAnalyticsRow[]>(`/analytics/campaigns/${id}/steps`);

export interface TemplateAnalyticsRow {
  id: string;
  name: string;
  campaigns: number;
  sent: number;
  opened: number;
  clicked: number;
  replied: number;
}

export interface SourceAnalyticsRow {
  source: string;
  leads: number;
  emailed: number;
  opened: number;
  replied: number;
  converted: number;
}

export const getTemplateAnalytics = (r?: Range) =>
  api<TemplateAnalyticsRow[]>(`/analytics/templates${qs(r)}`);

export const getSourceAnalytics = (r?: Range) =>
  api<SourceAnalyticsRow[]>(`/analytics/sources${qs(r)}`);

export const campaignReportPath = (r?: Range) => `/analytics/campaigns/export${qs(r)}`;

/** Presets → window. Days back from the start of today, through now. */
export function presetRange(days: number | null): Range {
  if (days === null) return {};
  const from = new Date();
  from.setHours(0, 0, 0, 0);
  from.setDate(from.getDate() - (days - 1));
  return { from: from.toISOString() };
}

// "12.3%" — or "—" when there's nothing to divide by.
export const pct = (n: number, d: number) =>
  d === 0 ? "—" : `${((n / d) * 100).toFixed(1).replace(/\.0$/, "")}%`;

// Human labels for lead_events types shown in activity feeds.
export const ACTIVITY_LABELS: Record<string, string> = {
  created: "was added",
  updated: "was updated",
  note_added: "got a note",
  status_changed: "changed status",
  email_sent: "was emailed",
  email_failed: "had a failed email",
  email_opened: "opened an email",
  email_clicked: "clicked a link",
  unsubscribed: "unsubscribed",
  imported: "was imported",
  merged: "was merged",
};

export function timeAgo(iso: string): string {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}
