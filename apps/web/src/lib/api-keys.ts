import { api } from "./api";

export interface ApiKey {
  id: string;
  name: string;
  prefix: string;
  created_at: string;
  last_used_at: string | null;
}

// create() returns the raw key exactly once.
export interface CreatedApiKey extends ApiKey {
  key: string;
}

export const listApiKeys = () => api<ApiKey[]>("/api-keys");

export const createApiKey = (name: string) =>
  api<CreatedApiKey>("/api-keys", {
    method: "POST",
    body: JSON.stringify({ name }),
  });

export const revokeApiKey = (id: string) =>
  api<{ revoked: boolean }>(`/api-keys/${id}`, { method: "DELETE" });
