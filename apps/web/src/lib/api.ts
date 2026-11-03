"use client";

/**
 * Minimal API client with transparent refresh-on-401.
 *
 * Session model: the refresh token is an httpOnly cookie the page can never
 * read; the 15-minute access token lives only in this module's memory. A
 * reload or new tab restores the session by spending the cookie
 * (ensureSession). Nothing secret touches localStorage — only a non-secret
 * "probably signed in" hint for marketing-page UI.
 */

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

const HINT_KEY = "ss.session";
// Pre-cookie builds kept tokens here; wiped on the next sign-in/out.
const LEGACY_KEYS = ["ss.accessToken", "ss.refreshToken"];

let accessToken: string | null = null;

function storage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

export function getAccessToken(): string | null {
  return accessToken;
}

/** Non-secret UI hint (e.g. "Open app" on the marketing site). The API is
 *  the only judge of whether a session is real. */
export function hasSessionHint(): boolean {
  return storage()?.getItem(HINT_KEY) === "1";
}

/** After sign-in/sign-up: keep the access token in memory. The refresh
 *  cookie was already set by the response. */
export function setSession(access: string) {
  accessToken = access;
  const st = storage();
  st?.setItem(HINT_KEY, "1");
  LEGACY_KEYS.forEach((k) => st?.removeItem(k));
}

/** Forget the session locally (the cookie stays until logout/expiry). */
export function clearSession() {
  accessToken = null;
  const st = storage();
  st?.removeItem(HINT_KEY);
  LEGACY_KEYS.forEach((k) => st?.removeItem(k));
}

/** Sign out everywhere this browser is signed in: revoke + clear the cookie. */
export async function logout() {
  try {
    await fetch(`${API_URL}/auth/logout`, {
      method: "POST",
      credentials: "include",
      headers: { "X-Requested-With": "supersaas" },
    });
  } catch {
    // offline: still drop the local session
  }
  clearSession();
}

/** Make sure there's a usable access token, restoring it from the refresh
 *  cookie when the page was just loaded. Throws on network failure (so the
 *  caller can offer a retry instead of a logout). */
export async function ensureSession(): Promise<boolean> {
  if (accessToken) return true;
  return tryRefresh();
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
  // include: auth responses set the refresh cookie, /auth/refresh reads it
  return fetch(`${API_URL}${path}`, { ...init, headers, credentials: "include" });
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

async function doRefresh(retry = true): Promise<boolean> {
  const res = await fetch(`${API_URL}/auth/refresh`, {
    method: "POST",
    credentials: "include",
    headers: { "X-Requested-With": "supersaas" },
  });
  // API restarting / deploy in progress: keep the session, let the caller
  // offer a retry rather than a logout.
  if (res.status >= 500) throw new ApiError(res.status, null);
  if (!res.ok) {
    // Another tab may have rotated the shared cookie a moment ago; the
    // browser now holds the newer one, so one retry settles the race.
    if (res.status === 401 && retry) {
      await new Promise((r) => setTimeout(r, 250));
      return doRefresh(false);
    }
    clearSession();
    return false;
  }
  const body = (await res.json()) as { accessToken: string };
  setSession(body.accessToken);
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

/** fetch() with the session token + one refresh-and-retry on 401, for
 *  calls the JSON helper doesn't fit (multipart uploads, file downloads). */
export async function authedFetch(path: string, init: RequestInit = {}) {
  const go = () => {
    const token = getAccessToken();
    return fetch(`${API_URL}${path}`, {
      ...init,
      credentials: "include",
      headers: {
        ...(init.headers as Record<string, string>),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    });
  };
  let res = await go();
  if (res.status === 401 && (await tryRefresh())) res = await go();
  return res;
}

/** Authenticated file download (CSV etc.): fetches with the session token
 *  and saves the response as `filename`. */
export async function downloadFile(path: string, filename: string) {
  const res = await authedFetch(path);
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
