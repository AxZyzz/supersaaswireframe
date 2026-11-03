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

/** Human-readable message from a failed call: Nest's `message` (string or
 *  validation array) when present, else a generic fallback. */
export function errorMessage(e: unknown, fallback = "Something went wrong."): string {
  if (e instanceof ApiError) {
    const m = (e.body as { message?: unknown } | null)?.message;
    if (typeof m === "string") return m;
    if (Array.isArray(m) && typeof m[0] === "string") return m[0];
  }
  return fallback;
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

// Refresh tokens rotate on use, and presenting an already-rotated one looks
// like theft to the server. So concurrent 401s share ONE in-flight refresh
// instead of each spending the same token.
let refreshing: Promise<boolean> | null = null;

function tryRefresh(): Promise<boolean> {
  refreshing ??= doRefresh().finally(() => {
    refreshing = null;
  });
  return refreshing;
}

async function doRefresh(): Promise<boolean> {
  const refresh =
    typeof window === "undefined" ? null : localStorage.getItem(REFRESH_KEY);
  if (!refresh) return false;
  const res = await rawRequest("/auth/refresh", {
    method: "POST",
    body: JSON.stringify({ refreshToken: refresh }),
  });
  if (!res.ok) {
    // Another tab (same localStorage) may have rotated it first — use theirs.
    if (localStorage.getItem(REFRESH_KEY) !== refresh) return true;
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

/** Authenticated file download (CSV etc.): fetches with the session token
 *  and saves the response as `filename`. */
export async function downloadFile(path: string, filename: string) {
  let res = await rawRequest(path, {}, getAccessToken());
  if (res.status === 401 && (await tryRefresh())) {
    res = await rawRequest(path, {}, getAccessToken());
  }
  if (!res.ok) {
    throw new ApiError(res.status, await res.json().catch(() => null));
  }
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
