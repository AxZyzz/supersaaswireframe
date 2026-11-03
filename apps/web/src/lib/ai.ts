import { api } from "./api";

export interface OrgKnowledge {
  description?: string | null;
  audience?: string | null;
  offer?: string | null;
  painPoints?: string | null;
  usps?: string | null;
  competitors?: string | null;
  testimonials?: string | null;
}

export interface GeneratedStep {
  subject: string;
  body: string;
  delayHours: number;
}

export interface SequenceResult {
  steps: GeneratedStep[];
  model: string;
  usage: { inputTokens: number; outputTokens: number };
}

export const getKnowledge = () => api<OrgKnowledge | null>("/ai/knowledge");

export const saveKnowledge = (body: OrgKnowledge) =>
  api<OrgKnowledge>("/ai/knowledge", {
    method: "PUT",
    body: JSON.stringify(body),
  });

export const generateSequence = (body: {
  goal: string;
  audience?: string;
  offer?: string;
  tone?: string;
  steps?: number;
}) =>
  api<SequenceResult>("/ai/generate-sequence", {
    method: "POST",
    body: JSON.stringify(body),
  });

export const campaignFromSequence = (body: {
  name: string;
  segmentId?: string;
  steps: GeneratedStep[];
}) =>
  api<{ id: string; name: string; status: string; steps: number }>(
    "/ai/campaigns/from-sequence",
    { method: "POST", body: JSON.stringify(body) },
  );

/** AI-suggested reply for an inbox conversation (T6.6) — a preview to edit. */
export const draftReply = (conversationId: string, instruction?: string) =>
  api<{ body: string }>("/ai/reply-draft", {
    method: "POST",
    body: JSON.stringify({ conversationId, instruction: instruction || undefined }),
  });

/** Revise one email by instruction (T6.3 chat editing). */
export const refineEmail = (body: { subject: string; body: string; instruction: string }) =>
  api<{ subject: string; body: string }>("/ai/refine", {
    method: "POST",
    body: JSON.stringify(body),
  });
