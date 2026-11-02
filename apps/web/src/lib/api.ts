"use client";

/**
 * Minimal API client with token storage and transparent refresh-on-401.
 * Beta tradeoff: tokens live in localStorage (XSS-exposed). Revisit with
 * httpOnly-cookie sessions before public launch (tracked in E10 security pass).
 */

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

const ACCESS_KEY = "ss.accessToken";
const REFRESH_KEY = "ss.refreshToken";

export function getAccessToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(ACCESS_KEY);
}

export function setTokens(access: string, refresh: string) {
  localStorage.setItem(ACCESS_KEY, access);
  localStorage.setItem(REFRESH_KEY, refresh);
}

export function clearTokens() {
  localStorage.removeItem(ACCESS_KEY);
  localStorage.removeItem(REFRESH_KEY);
}

export class ApiError extends Error {
  constructor(
    public status: number,
    public body: unknown,
  ) {
    super(`API ${status}`);
  }
}

async function rawRequest(
  path: string,
  init: RequestInit = {},
  token?: string | null,
): Promise<Response> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(init.headers as Record<string, string>),
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  return fetch(`${API_URL}${path}`, { ...init, headers });
}

async function tryRefresh(): Promise<boolean> {
  const refresh =
    typeof window === "undefined" ? null : localStorage.getItem(REFRESH_KEY);
  if (!refresh) return false;
  const res = await rawRequest("/auth/refresh", {
    method: "POST",
    body: JSON.stringify({ refreshToken: refresh }),
  });
  if (!res.ok) {
    clearTokens();
    return false;
  }
  const body = (await res.json()) as {
    accessToken: string;
    refreshToken: string;
  };
  setTokens(body.accessToken, body.refreshToken);
  return true;
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  let res = await rawRequest(path, init, getAccessToken());
  if (res.status === 401 && (await tryRefresh())) {
    res = await rawRequest(path, init, getAccessToken());
  }
  if (!res.ok) {
    throw new ApiError(res.status, await res.json().catch(() => null));
  }
  if (res.status === 204) return undefined as T;
  // Nest sends a 200 with an empty body when a handler returns null.
  const text = await res.text();
  return (text ? JSON.parse(text) : null) as T;
}
