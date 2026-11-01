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
  alerts: { kind: "sender_unverified" | "sender_near_limit"; message: string }[];
}

export interface CampaignAnalyticsRow {
  id: string;
  name: string;
  status: string;
  enrolled: number;
  sent: number;
  opened: number;
  clicked: number;
  unsubscribed: number;
}

export const getOverview = () => api<Overview>("/analytics/overview");

export const getCampaignAnalytics = () =>
  api<CampaignAnalyticsRow[]>("/analytics/campaigns");

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
