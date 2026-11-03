import { api } from "./api";

export interface Condition {
  field: string;
  op: string;
  value?: string | number;
}
export interface RuleSet {
  match: "all" | "any";
  conditions: Condition[];
}

export interface Segment {
  id: string;
  name: string;
  type: "manual" | "smart";
  rules: RuleSet;
  member_count: number;
  last_refreshed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface SegmentMember {
  id: string;
  email: string | null;
  first_name: string | null;
  last_name: string | null;
  company: string | null;
  status: string;
  score: "hot" | "warm" | "cold" | null;
}

export const listSegments = () => api<Segment[]>("/segments");
export const getSegment = (id: string) => api<Segment>(`/segments/${id}`);

export const createSegment = (body: {
  name: string;
  type: "manual" | "smart";
  rules?: RuleSet;
}) => api<Segment>("/segments", { method: "POST", body: JSON.stringify(body) });

export const deleteSegment = (id: string) =>
  api<{ deleted: boolean }>(`/segments/${id}`, { method: "DELETE" });

export const refreshSegment = (id: string) =>
  api<{ queued: boolean }>(`/segments/${id}/refresh`, { method: "POST" });

export const listSegmentMembers = (id: string, limit = 50, offset = 0) =>
  api<{ data: SegmentMember[]; total: number; limit: number; offset: number }>(
    `/segments/${id}/leads?limit=${limit}&offset=${offset}`,
  );

/** Manual segments only; leads already in the segment are ignored. */
export const addSegmentMembers = (id: string, leadIds: string[]) =>
  api<{ memberCount: number }>(`/segments/${id}/members`, {
    method: "POST",
    body: JSON.stringify({ leadIds }),
  });

export const removeSegmentMember = (id: string, leadId: string) =>
  api<{ memberCount: number }>(`/segments/${id}/members/${leadId}`, {
    method: "DELETE",
  });

// Rule-builder metadata: which ops + value input each field supports.
export const RULE_FIELDS: Record<
  string,
  { label: string; ops: { op: string; label: string }[]; value: "text" | "score" | "number" | "tag" | "none" }
> = {
  status: { label: "Status", ops: [{ op: "eq", label: "is" }], value: "text" },
  score: { label: "Score", ops: [{ op: "eq", label: "is" }], value: "score" },
  source: {
    label: "Source",
    ops: [
      { op: "eq", label: "is" },
      { op: "contains", label: "contains" },
    ],
    value: "text",
  },
  company: {
    label: "Company",
    ops: [{ op: "contains", label: "contains" }],
    value: "text",
  },
  email: {
    label: "Email",
    ops: [
      { op: "present", label: "is present" },
      { op: "absent", label: "is missing" },
    ],
    value: "none",
  },
  tag: {
    label: "Tag",
    ops: [
      { op: "has", label: "has" },
      { op: "not_has", label: "does not have" },
    ],
    value: "tag",
  },
  engagement: {
    label: "Engagement",
    ops: [
      { op: "emailed", label: "has been emailed" },
      { op: "never_emailed", label: "never emailed" },
      { op: "opened", label: "opened an email" },
      { op: "never_opened", label: "emailed, never opened" },
      { op: "clicked", label: "clicked a link" },
      { op: "replied", label: "replied" },
      { op: "not_replied", label: "emailed, no reply" },
    ],
    value: "none",
  },
  created: {
    label: "Created",
    ops: [{ op: "within_days", label: "within (days)" }],
    value: "number",
  },
};
