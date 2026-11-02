import { api } from "./api";

export type Role = "admin" | "manager" | "agent";

export const ROLE_META: Record<Role, { label: string; desc: string }> = {
  admin: { label: "Admin", desc: "Everything, incl. team, billing and workspace settings" },
  manager: { label: "Manager", desc: "Campaigns, senders, templates, leads and inbox" },
  agent: { label: "Agent", desc: "Works leads and the inbox" },
};

export interface TeamMember {
  user_id: string;
  role: Role;
  name: string;
  email: string;
  created_at: string;
}

export interface PendingInvite {
  id: string;
  email: string;
  role: Role;
  expires_at: string;
  created_at: string;
  invited_by_name: string | null;
}

export interface CreatedInvite extends Omit<PendingInvite, "invited_by_name"> {
  token: string;
}

export interface InvitePreview {
  orgName: string;
  email: string;
  role: Role;
  status: "pending" | "expired" | "accepted";
}

interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

export const listTeam = () => api<TeamMember[]>("/orgs/members");
export const listInvites = () => api<PendingInvite[]>("/orgs/invites");

export const createInvite = (email: string, role: Role) =>
  api<CreatedInvite>("/orgs/invites", {
    method: "POST",
    body: JSON.stringify({ email, role }),
  });

export const revokeInvite = (id: string) =>
  api<{ revoked: string }>(`/orgs/invites/${id}`, { method: "DELETE" });

export const changeRole = (userId: string, role: Role) =>
  api<{ userId: string; role: Role }>(`/orgs/members/${userId}`, {
    method: "PATCH",
    body: JSON.stringify({ role }),
  });

export const removeMember = (userId: string) =>
  api<{ removed: string }>(`/orgs/members/${userId}`, { method: "DELETE" });

export const previewInvite = (token: string) =>
  api<InvitePreview>(`/invites/${encodeURIComponent(token)}`);

export const acceptInvite = (token: string) =>
  api<TokenPair>(`/invites/${encodeURIComponent(token)}/accept`, {
    method: "POST",
  });

export const registerInvite = (token: string, name: string, password: string) =>
  api<TokenPair>(`/invites/${encodeURIComponent(token)}/register`, {
    method: "POST",
    body: JSON.stringify({ name, password }),
  });

export const inviteLink = (token: string) =>
  `${window.location.origin}/invite/${token}`;
