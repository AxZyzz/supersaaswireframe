import { api } from "./api";

export interface Org {
  id: string;
  name: string;
  slug: string;
  website: string | null;
  industry: string | null;
  team_size: string | null;
  timezone: string;
  brand_color: string | null;
  logo_data: string | null;
  onboarded_at: string | null;
  postal_address: string | null;
}

export interface SetupStatus {
  profile: boolean;
  knowledge: boolean;
  sender: boolean;
  senderVerified: boolean;
  leads: boolean;
  campaign: boolean;
  onboarded: boolean;
}

export type OrgPatch = Partial<{
  name: string;
  website: string | null;
  industry: string | null;
  teamSize: string | null;
  timezone: string;
  brandColor: string | null;
  logoData: string | null;
  postalAddress: string | null;
}>;

export const TEAM_SIZES = [
  { value: "1", label: "Just me" },
  { value: "2-10", label: "2–10" },
  { value: "11-50", label: "11–50" },
  { value: "50+", label: "50+" },
];

export const INDUSTRIES = [
  "Agency",
  "SaaS / Software",
  "Directory / Community",
  "Professional services",
  "E-commerce",
  "Recruiting",
  "Other",
];

export const getOrg = () => api<Org>("/orgs/me");

export const updateOrg = (body: OrgPatch) =>
  api<Org>("/orgs/me", { method: "PATCH", body: JSON.stringify(body) });

export const getSetup = () => api<SetupStatus>("/orgs/me/setup");

export const completeOnboarding = () =>
  api<{ onboardedAt: string }>("/orgs/me/onboarding/complete", {
    method: "POST",
  });

/** Timezones for pickers; falls back to a short list on old runtimes. */
export function timezones(): string[] {
  try {
    return ["UTC", ...Intl.supportedValuesOf("timeZone")];
  } catch {
    return ["UTC", "America/New_York", "Europe/London", "Asia/Kolkata"];
  }
}

export const exportWorkspace = () => api<unknown>("/orgs/me/export");

export const deleteWorkspace = (confirmName: string) =>
  api<{ deleted: boolean; accountsRemoved: number }>("/orgs/me", {
    method: "DELETE",
    body: JSON.stringify({ confirmName }),
  });

export const deleteAccount = (password: string) =>
  api<{ deleted: boolean; workspacesDeleted: number }>("/auth/me", {
    method: "DELETE",
    body: JSON.stringify({ password }),
  });
