import { api } from "./api";

export type CampaignStatus =
  | "draft"
  | "scheduled"
  | "active"
  | "paused"
  | "completed"
  | "archived";

export type StepCondition = "always" | "opened_no_reply" | "not_opened";

/**
 * When a campaign may send (Learning Loop T17): ISO weekdays (1 = Monday ...
 * 7 = Sunday), whole hours (end is exclusive, no overnight windows), read on the
 * recipient's clock (the workspace's when we don't know theirs) or the workspace's.
 */
export interface SendWindow {
  days: number[];
  startHour: number;
  endHour: number;
  tzBasis: "recipient" | "workspace";
}

export const DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;

const hh = (h: number) => `${String(h).padStart(2, "0")}:00`;

/** "Tue-Thu 09:00-11:00 (recipient time)": same words as the API's history and Review. */
export function describeSendWindow(w: SendWindow): string {
  const days = [...w.days].sort((a, b) => a - b);
  const runs: string[] = [];
  let i = 0;
  while (i < days.length) {
    let j = i;
    while (j + 1 < days.length && days[j + 1] === days[j] + 1) j++;
    runs.push(
      j - i >= 2
        ? `${DAY_NAMES[days[i] - 1]}-${DAY_NAMES[days[j] - 1]}`
        : days
            .slice(i, j + 1)
            .map((d) => DAY_NAMES[d - 1])
            .join(", "),
    );
    i = j + 1;
  }
  return `${runs.join(", ")} ${hh(w.startHour)}-${hh(w.endHour)} (${w.tzBasis} time)`;
}

export const sameSendWindow = (a: SendWindow, b: SendWindow) =>
  a.startHour === b.startHour &&
  a.endHour === b.endHour &&
  a.tzBasis === b.tzBasis &&
  [...a.days].sort().join() === [...b.days].sort().join();

export interface Campaign {
  id: string;
  name: string;
  status: CampaignStatus;
  segment_id: string | null;
  offer_id: string | null;
  sender_ids: string[];
  /** T17: null = no window, the campaign sends whenever a step is due. */
  send_window: SendWindow | null;
  scheduled_at: string | null;
  started_at: string | null;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
  steps?: number;
  leads?: number;
}

export interface CampaignStep {
  id: string;
  campaign_id: string;
  step_order: number;
  template_id: string | null;
  delay_hours: number;
  condition: StepCondition;
  subject_variants: string[];
  created_at: string;
}

export interface CampaignDetail extends Omit<Campaign, "steps" | "leads"> {
  steps: CampaignStep[];
}

export const CONDITION_LABELS: Record<StepCondition, string> = {
  always: "Always send",
  opened_no_reply: "If opened, no reply",
  not_opened: "If not opened",
};

export const listCampaigns = () => api<Campaign[]>("/campaigns");

export const getCampaign = (id: string) =>
  api<CampaignDetail>(`/campaigns/${id}`);

export const createCampaign = (body: {
  name: string;
  segmentId?: string;
  offerId?: string;
}) =>
  api<Campaign>("/campaigns", { method: "POST", body: JSON.stringify(body) });

export const updateCampaign = (
  id: string,
  body: Partial<{
    name: string;
    status: CampaignStatus;
    segmentId: string | null;
    offerId: string | null;
    senderIds: string[];
    /** null clears the window. */
    sendWindow: SendWindow | null;
  }>,
) => api<Campaign>(`/campaigns/${id}`, {
  method: "PATCH",
  body: JSON.stringify(body),
});

export const deleteCampaign = (id: string) =>
  api<{ deleted: boolean }>(`/campaigns/${id}`, { method: "DELETE" });

export const archiveCampaign = (id: string) =>
  api<Campaign>(`/campaigns/${id}/archive`, { method: "POST" });

export const duplicateCampaign = (id: string) =>
  api<Campaign>(`/campaigns/${id}/duplicate`, { method: "POST" });

export const pauseCampaign = (id: string) =>
  api<Campaign>(`/campaigns/${id}/pause`, { method: "POST" });

export const resumeCampaign = (id: string) =>
  api<Campaign>(`/campaigns/${id}/resume`, { method: "POST" });

export const scheduleCampaign = (id: string, scheduledAt: string) =>
  api<Campaign & { enrolled: number }>(`/campaigns/${id}/schedule`, {
    method: "POST",
    body: JSON.stringify({ scheduledAt }),
  });

export const campaignAudience = (id: string) =>
  api<{ count: number }>(`/campaigns/${id}/audience`);

export interface CampaignStats {
  leads: { total: number; active: number; completed: number; stopped: number };
  sent: number;
  opened: number;
  clicked: number;
  unsubscribed: number;
  bounced: number;
  variants: {
    variant_index: number;
    sent: number;
    opened: number;
    clicked: number;
  }[];
}

export const campaignStats = (id: string) =>
  api<CampaignStats>(`/campaigns/${id}/stats`);

export const enrollCampaign = (id: string) =>
  api<{ enrolled: number }>(`/campaigns/${id}/enroll`, { method: "POST" });

// Manually process this org's due sends now (dev; prod runs a scheduler).
export const runDueSends = () =>
  api<Record<string, number>>(`/sending/tick`, { method: "POST" });

export const addStep = (
  id: string,
  body: {
    templateId?: string;
    delayHours?: number;
    condition?: StepCondition;
    subjectVariants?: string[];
  },
) => api<CampaignStep>(`/campaigns/${id}/steps`, {
  method: "POST",
  body: JSON.stringify(body),
});

export const removeStep = (stepId: string) =>
  api<{ deleted: boolean }>(`/campaigns/steps/${stepId}`, { method: "DELETE" });

// ── Learning Loop T02: Company-level subject experiments ─────────────────
export interface ExperimentVariant {
  id: string;
  experiment_id: string;
  label: string;
  subject: string;
  template_id: string | null;
  template_version: number;
  is_control: boolean;
  status: "draft" | "active" | "paused";
  /** T17: this arm's send window in a send-time test; null for subject tests. */
  send_window: SendWindow | null;
  assigned_companies?: number;
  sent_count?: number;
}

export interface Experiment {
  id: string;
  campaign_id: string;
  step_id: string;
  /** 'subject' (T02) or 'send_time' (T17). */
  kind: "subject" | "send_time";
  status: "draft" | "running" | "decided" | "stopped";
  unit: string;
  primary_metric: string;
  secondary_metric: string;
  baseline_rate: number;
  min_lift_pp: number;
  target_n_per_arm: number | null;
  response_window_days: number;
  decision_date: string | null;
  guardrails: { bounce?: number; unsubscribe?: number; complaint?: number };
  offer_ref: string | null;
  started_at: string | null;
  stopped_at: string | null;
  variants: ExperimentVariant[];
  assigned_companies: number;
  ineligible_count: number;
}

export const listCampaignExperiments = (campaignId: string) =>
  api<Experiment[]>(`/campaigns/${campaignId}/experiments`);

export const createCampaignExperiment = (
  campaignId: string,
  body: {
    stepId?: string;
    /** 'subject' (default) takes `variants`; 'send_time' takes `windows`. */
    kind?: "subject" | "send_time";
    variants?: { label?: string; subject: string }[];
    windows?: { label?: string; window: SendWindow }[];
    primaryMetric?: "qualified_reply" | "booked_call";
    secondaryMetric?: "booked_call" | "qualified_reply";
    baselineRate?: number;
    minLiftPp?: number;
    targetNPerArm?: number | null;
    responseWindowDays?: number;
    decisionDate?: string | null;
  },
) =>
  api<Experiment>(`/campaigns/${campaignId}/experiments`, {
    method: "POST",
    body: JSON.stringify(body),
  });

export const updateExperiment = (
  id: string,
  body: Partial<{
    variants: { label?: string; subject: string }[];
    windows: { label?: string; window: SendWindow }[];
    baselineRate: number;
    minLiftPp: number;
    targetNPerArm: number | null;
    responseWindowDays: number;
    decisionDate: string | null;
  }>,
) =>
  api<Experiment>(`/experiments/${id}`, {
    method: "PATCH",
    body: JSON.stringify(body),
  });

export const startExperiment = (id: string) =>
  api<Experiment>(`/experiments/${id}/start`, { method: "POST" });

export const stopExperiment = (id: string) =>
  api<Experiment>(`/experiments/${id}/stop`, { method: "POST" });
