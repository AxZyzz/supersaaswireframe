import { api } from "./api";

export interface ApiKey {
  id: string;
  name: string;
  prefix: string;
  rate_limit_per_min: number;
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

export const setApiKeyRateLimit = (id: string, rateLimitPerMin: number) =>
  api<ApiKey>(`/api-keys/${id}`, {
    method: "PATCH",
    body: JSON.stringify({ rateLimitPerMin }),
  });

export const revokeApiKey = (id: string) =>
  api<{ revoked: boolean }>(`/api-keys/${id}`, { method: "DELETE" });
