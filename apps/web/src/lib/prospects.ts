import { api } from "@/lib/api";

export interface Icp {
  summary?: string;
  industries?: string[];
  regions?: string[];
  companySize?: string;
  buyerRoles?: string[];
  signals?: string[];
  exclusions?: string[];
}

export interface ProspectRun {
  id: string;
  goal: string;
  offer_id?: string | null;
  icp: Icp | null;
  status: "queued" | "running" | "done" | "failed";
  requested: number;
  total: number;
  done: number;
  verified: number;
  error: string | null;
  created_at: string;
  finished_at: string | null;
  /** T12: the search preference this run pinned, and the sentence about how it was used. */
  preference_id?: string | null;
  allocation_line?: string | null;
  /** T10: what the Discover agent did (only when DISCOVER_DRIVER=agent). */
  agent_steps?: { at: string; text: string }[];
  /** T14: the playbooks the search was planned with ("Used 2 playbooks"). */
  playbooks_used?: { id: string; title: string }[];
}

export interface ProspectTrigger {
  type: "hiring" | "expansion" | "funding" | "product_launch";
  quote: string;
  url: string;
  observed_at: string | null;
}

export interface Evidence {
  fact: string;
  quote: string;
  url: string;
}

export interface ProspectEmail {
  email: string;
  url: string;
  onCompanyDomain: boolean;
  mx: boolean;
}

export interface Prospect {
  id: string;
  company_name: string;
  domain: string;
  website_url: string | null;
  reason: string | null;
  status: "pending" | "researching" | "verified" | "unverified" | "rejected" | "unreachable";
  summary: string | null;
  industry: string | null;
  location: string | null;
  fit_score: number | null;
  stars: number | null;
  /** T12: found through the search preference (its own website confirmed the factor). */
  via_preference?: boolean;
  score_parts: Record<"icp" | "opportunity" | "timing" | "commercial" | "contact", number> | null;
  evidence: Evidence[];
  opportunity: { hypothesis: string; service: string; discoveryQuestion: string } | null;
  unknowns: string[];
  emails: ProspectEmail[];
  pages: string[];
  error: string | null;
  lead_id: string | null;
  city?: string | null;
  region?: string | null;
  country?: string | null;
  size_band?: string | null;
  triggers?: ProspectTrigger[];
  timezone?: string | null;
  mail_provider?: string | null;
  company_key?: string | null;
}

export const startProspectRun = (
  goal: string,
  count: number,
  offerId?: string,
) =>
  api<ProspectRun>("/prospects/runs", {
    method: "POST",
    body: JSON.stringify({ goal, count, offerId: offerId || undefined }),
  });

export const listProspectRuns = () => api<ProspectRun[]>("/prospects/runs");

export const getProspectRun = (id: string) =>
  api<ProspectRun & { prospects: Prospect[] }>(`/prospects/runs/${id}`);

export const addProspectsToLeads = (prospectIds: string[], segmentName?: string) =>
  api<{
    added: number;
    skipped: { domain: string; reason: string }[];
    segment: { id: string; name: string } | null;
  }>("/prospects/add-to-leads", {
    method: "POST",
    body: JSON.stringify({ prospectIds, segmentName: segmentName || undefined }),
  });

/** A prospect can become a lead only with a real on-site email that accepts mail. */
export const contactable = (p: Prospect) =>
  p.status === "verified" && p.emails.some((e) => e.mx);
