import { api } from "./api";

export type CampaignStatus =
  | "draft"
  | "scheduled"
  | "active"
  | "paused"
  | "completed"
  | "archived";

export type StepCondition = "always" | "opened_no_reply" | "not_opened";

export interface Campaign {
  id: string;
  name: string;
  status: CampaignStatus;
  segment_id: string | null;
  sender_ids: string[];
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

export const createCampaign = (body: { name: string; segmentId?: string }) =>
  api<Campaign>("/campaigns", { method: "POST", body: JSON.stringify(body) });

export const updateCampaign = (
  id: string,
  body: Partial<{
    name: string;
    status: CampaignStatus;
    segmentId: string | null;
    senderIds: string[];
  }>,
) => api<Campaign>(`/campaigns/${id}`, {
  method: "PATCH",
  body: JSON.stringify(body),
});

export const deleteCampaign = (id: string) =>
  api<{ deleted: boolean }>(`/campaigns/${id}`, { method: "DELETE" });

export const archiveCampaign = (id: string) =>
  api<Campaign>(`/campaigns/${id}/archive`, { method: "POST" });

export const campaignAudience = (id: string) =>
  api<{ count: number }>(`/campaigns/${id}/audience`);

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
