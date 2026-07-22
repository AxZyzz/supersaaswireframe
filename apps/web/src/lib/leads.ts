import { api } from "./api";

export interface Lead {
  id: string;
  email: string | null;
  first_name: string | null;
  last_name: string | null;
  company: string | null;
  title: string | null;
  phone: string | null;
  status: string;
  score: "hot" | "warm" | "cold" | null;
  source: string | null;
  custom: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface LeadTag {
  id: string;
  name: string;
  color: string;
}
export interface LeadNote {
  id: string;
  body: string;
  author_user_id: string | null;
  created_at: string;
}
export interface LeadEvent {
  id: string;
  type: string;
  data: Record<string, unknown>;
  created_at: string;
}
export interface LeadDetail extends Lead {
  tags: LeadTag[];
  notes: LeadNote[];
  events: LeadEvent[];
}

export interface LeadListResult {
  data: Lead[];
  total: number;
  limit: number;
  offset: number;
}

export interface LeadFilters {
  search?: string;
  status?: string;
  score?: string;
  tagId?: string;
  limit?: number;
  offset?: number;
}

export function listLeads(f: LeadFilters): Promise<LeadListResult> {
  const q = new URLSearchParams();
  if (f.search) q.set("search", f.search);
  if (f.status) q.set("status", f.status);
  if (f.score) q.set("score", f.score);
  if (f.tagId) q.set("tagId", f.tagId);
  q.set("limit", String(f.limit ?? 50));
  q.set("offset", String(f.offset ?? 0));
  return api<LeadListResult>(`/leads?${q.toString()}`);
}

export const getLead = (id: string) => api<LeadDetail>(`/leads/${id}`);

// Write payload is camelCase to match the API DTOs; responses stay snake_case
// (raw DB columns). Keep the two shapes distinct so callers can't send the
// wrong casing — the API's whitelist ValidationPipe 400s on unknown keys.
export interface LeadInput {
  email?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  company?: string | null;
  title?: string | null;
  phone?: string | null;
  status?: string;
  score?: "hot" | "warm" | "cold" | null;
  source?: string | null;
}

export const createLead = (body: LeadInput) =>
  api<Lead>("/leads", { method: "POST", body: JSON.stringify(body) });

export const updateLead = (id: string, body: LeadInput) =>
  api<Lead>(`/leads/${id}`, { method: "PATCH", body: JSON.stringify(body) });

export const addNote = (id: string, body: string) =>
  api<LeadNote>(`/leads/${id}/notes`, {
    method: "POST",
    body: JSON.stringify({ body }),
  });

export const listTags = () => api<LeadTag[]>("/tags");

export const LEAD_STATUSES = [
  "new",
  "contacted",
  "replied",
  "interested",
  "converted",
  "lost",
];

export const SCORE_STYLES: Record<string, string> = {
  hot: "bg-danger-bg text-danger-text",
  warm: "bg-warning-bg text-warning-text",
  cold: "bg-info-bg text-info-text",
};
