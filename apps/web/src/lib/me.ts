"use client";

import { useEffect, useState } from "react";
import { api, getAccessToken } from "./api";

export interface Me {
  userId: string;
  orgId: string;
  role: "admin" | "manager" | "agent";
  isOperator: boolean;
}

// One /auth/me per access token, shared by every component that asks.
let cached: { token: string | null; p: Promise<Me> } | null = null;

export function getMe(): Promise<Me> {
  const token = getAccessToken();
  if (!cached || cached.token !== token) {
    cached = { token, p: api<Me>("/auth/me") };
  }
  return cached.p;
}

/** Current role, or null while loading. UI hiding only — the API enforces
 *  every permission regardless (docs/AUTHZ-MATRIX.md). */
export function useRole(): Me["role"] | null {
  const [role, setRole] = useState<Me["role"] | null>(null);
  useEffect(() => {
    void getMe().then((m) => setRole(m.role));
  }, []);
  return role;
}

/** Admins and managers run campaigns, templates, imports and merges. */
export const canManage = (role: Me["role"] | null) =>
  role === "admin" || role === "manager";

/** A2B staff flag (operator console access). */
export function useIsOperator(): boolean {
  const [op, setOp] = useState(false);
  useEffect(() => {
    void getMe().then((m) => setOp(!!m.isOperator));
  }, []);
  return op;
}
