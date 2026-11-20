import { api } from "./api";

/** Learning Loop T03: outcome events and human verification. */
export type OutcomeType = "qualified_reply" | "booked_call" | "reply";
export type Verification = "provisional" | "verified" | "rejected";

export interface Outcome {
  id: string;
  type: OutcomeType;
  source: string;
  verification: Verification;
  campaign_lead_id: string | null;
  lead_id: string | null;
  company_key: string | null;
  experiment_id: string | null;
  variant_id: string | null;
  conversation_id: string | null;
  occurred_at: string;
  verified_by: string | null;
  verified_by_name: string | null;
  verified_at: string | null;
  reason: string | null;
  lead_email: string | null;
  lead_name: string | null;
  lead_company: string | null;
  campaign_id: string | null;
  campaign_name: string | null;
}

export interface OutcomeHistoryRow {
  id: string;
  type: OutcomeType;
  source: string;
  verification: Verification;
  created_at: string;
  verified_at: string | null;
  verified_by_name: string | null;
  reason: string | null;
}

export const listOutcomes = (q: {
  status?: Verification;
  campaignId?: string;
  conversationId?: string;
}) => {
  const p = new URLSearchParams();
  if (q.status) p.set("status", q.status);
  if (q.campaignId) p.set("campaignId", q.campaignId);
  if (q.conversationId) p.set("conversationId", q.conversationId);
  return api<Outcome[]>(`/outcomes?${p.toString()}`);
};

export const listUnattributed = () => api<Outcome[]>("/outcomes/unattributed");

export const outcomeHistory = (conversationId: string) =>
  api<OutcomeHistoryRow[]>(`/outcomes/history/${conversationId}`);

export const verifyOutcome = (
  id: string,
  decision: "verified" | "rejected",
  reason?: string,
) =>
  api<Outcome>(`/outcomes/${id}/verify`, {
    method: "POST",
    body: JSON.stringify({ decision, reason: reason || undefined }),
  });

export const getRubric = () =>
  api<{ rubric: string; isDefault: boolean }>("/review/rubric");

export const saveRubric = (rubric: string) =>
  api<{ rubric: string; isDefault: boolean }>("/review/rubric", {
    method: "PUT",
    body: JSON.stringify({ rubric }),
  });

export const OUTCOME_LABEL: Record<OutcomeType, string> = {
  qualified_reply: "Qualified reply",
  booked_call: "Booked call",
  reply: "Reply",
};
