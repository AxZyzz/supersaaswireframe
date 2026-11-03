"use client";

import { useEffect, useState } from "react";
import { api } from "./api";
import { LEAD_STATUSES } from "./leads";

/** Workspace lead status list (T2.3). System ones drive automations. */
export interface LeadStatus {
  name: string;
  color: StatusColor;
  system: boolean;
  count: number;
}

export const STATUS_COLORS = ["gray", "blue", "teal", "green", "amber", "red", "purple"] as const;
export type StatusColor = (typeof STATUS_COLORS)[number];

// Static class names so Tailwind keeps them.
export const STATUS_DOT: Record<string, string> = {
  gray: "bg-gray-400",
  blue: "bg-blue-500",
  teal: "bg-teal-500",
  green: "bg-green-500",
  amber: "bg-amber-500",
  red: "bg-red-500",
  purple: "bg-purple-500",
};

export const listLeadStatuses = () => api<LeadStatus[]>("/lead-statuses");

export const saveLeadStatuses = (statuses: { name: string; color: string }[]) =>
  api<LeadStatus[]>("/lead-statuses", {
    method: "PUT",
    body: JSON.stringify({ statuses }),
  });

export const renameLeadStatus = (from: string, to: string) =>
  api<{ leadsMoved: number }>("/lead-statuses/rename", {
    method: "POST",
    body: JSON.stringify({ from, to }),
  });

export const deleteLeadStatus = (name: string, moveTo: string) =>
  api<{ leadsMoved: number }>(
    `/lead-statuses/${encodeURIComponent(name)}?moveTo=${encodeURIComponent(moveTo)}`,
    { method: "DELETE" },
  );

// One fetch shared by every picker; the manager broadcasts changes.
let cache: Promise<LeadStatus[]> | null = null;
const EVENT = "lead-statuses-changed";

export function invalidateLeadStatuses() {
  cache = null;
  window.dispatchEvent(new Event(EVENT));
}

const FALLBACK: LeadStatus[] = LEAD_STATUSES.map((name) => ({
  name,
  color: "gray",
  system: true,
  count: 0,
}));

/** Ordered statuses for pickers/kanban; system defaults until loaded. */
export function useLeadStatuses(): LeadStatus[] {
  const [list, setList] = useState<LeadStatus[]>(FALLBACK);
  useEffect(() => {
    const load = () => {
      cache ??= listLeadStatuses().catch(() => FALLBACK);
      void cache.then(setList);
    };
    load();
    window.addEventListener(EVENT, load);
    return () => window.removeEventListener(EVENT, load);
  }, []);
  return list;
}

export function StatusDot({ color }: { color?: string }) {
  return (
    <span
      aria-hidden
      className={`inline-block h-2 w-2 shrink-0 rounded-full ${STATUS_DOT[color ?? "gray"] ?? STATUS_DOT.gray}`}
    />
  );
}
