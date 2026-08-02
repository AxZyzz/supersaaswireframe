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
