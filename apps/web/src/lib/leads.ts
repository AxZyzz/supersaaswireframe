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

export const bulkTag = (
  leadIds: string[],
  tagId: string,
  action: "attach" | "detach",
) =>
  api<{ attached?: number; detached?: number }>("/tags/bulk", {
    method: "POST",
    body: JSON.stringify({ leadIds, tagId, action }),
  });

export const deleteTag = (id: string) =>
  api<{ deleted: boolean }>(`/tags/${id}`, { method: "DELETE" });

export interface DuplicateGroup {
  count: number;
  leads: Lead[];
}

export const findDuplicates = () =>
  api<DuplicateGroup[]>("/leads/duplicates");

export const mergeLeads = (primaryId: string, mergeIds: string[]) =>
  api<{ merged: number; primaryId: string }>("/leads/merge", {
    method: "POST",
    body: JSON.stringify({ primaryId, mergeIds }),
  });

export interface ImportJob {
  id: string;
  status: "pending" | "processing" | "completed" | "failed";
  total: number;
  imported: number;
  updated: number;
  skipped: number;
  errors: { row: number; reason: string }[];
}

export const IMPORTABLE_FIELDS = [
  "email",
  "firstName",
  "lastName",
  "company",
  "title",
  "phone",
  "status",
  "score",
  "source",
] as const;

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

// Multipart upload — separate from the JSON api() helper.
export async function uploadImport(
  file: File,
  mapping: Record<string, string>,
  onDuplicate: "skip" | "update",
): Promise<{ jobId: string }> {
  const token =
    typeof window === "undefined"
      ? null
      : localStorage.getItem("ss.accessToken");
  const form = new FormData();
  form.append("file", file);
  form.append("mapping", JSON.stringify(mapping));
  form.append("onDuplicate", onDuplicate);
  const res = await fetch(`${API_URL}/leads/import`, {
    method: "POST",
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    body: form,
  });
  if (!res.ok) throw new Error(`Import failed (${res.status})`);
  return res.json() as Promise<{ jobId: string }>;
}

export const getImportStatus = (id: string) =>
  api<ImportJob>(`/leads/import/${id}`);

// Authenticated CSV download — fetch as blob (can't use a plain <a href> since
// the endpoint needs the bearer token).
export async function exportLeads(f: LeadFilters): Promise<void> {
  const token =
    typeof window === "undefined"
      ? null
      : localStorage.getItem("ss.accessToken");
  const q = new URLSearchParams();
  if (f.search) q.set("search", f.search);
  if (f.status) q.set("status", f.status);
  if (f.score) q.set("score", f.score);
  if (f.tagId) q.set("tagId", f.tagId);
  const res = await fetch(`${API_URL}/leads/export?${q.toString()}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) throw new Error(`Export failed (${res.status})`);
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "leads.csv";
  a.click();
  URL.revokeObjectURL(url);
}

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

/** forget = GDPR erasure: delete the lead, keep the address suppressed. */
export const deleteLead = (id: string, forget = false) =>
  api<{ deleted: boolean }>(`/leads/${id}${forget ? "?forget=true" : ""}`, {
    method: "DELETE",
  });
