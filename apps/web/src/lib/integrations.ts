import { api } from "./api";

export interface IntegrationsOverview {
  gmail: { available: boolean; senders: number; verified: number };
  googleSheets: {
    available: boolean;
    connected: boolean;
    accountEmail: string | null;
    connectedAt: string | null;
    syncs: number;
  };
  ses: { available: boolean };
}

export interface SheetPreview {
  spreadsheetId: string;
  title: string;
  sheets: string[];
  sheet: string;
  headers: string[];
  rows: string[][];
  totalRows: number;
}

export interface SheetSync {
  id: string;
  spreadsheet_id: string;
  spreadsheet_title: string;
  sheet_title: string;
  enabled: boolean;
  last_synced_at: string | null;
  last_status: "ok" | "error" | null;
  last_error: string | null;
  job_status: string | null;
  job_total: number | null;
  job_imported: number | null;
  job_updated: number | null;
  job_skipped: number | null;
}

export const getIntegrations = () => api<IntegrationsOverview>("/integrations");

/** Google consent URL; navigate there. Google returns to `returnTo`. */
export const connectSheets = (returnTo: "/leads" | "/settings") =>
  api<{ url: string }>("/integrations/google-sheets/connect", {
    method: "POST",
    body: JSON.stringify({ returnTo }),
  });

export const disconnectSheets = () =>
  api<{ disconnected: boolean }>("/integrations/google-sheets", { method: "DELETE" });

export const previewSheet = (url: string, sheet?: string) =>
  api<SheetPreview>("/integrations/google-sheets/preview", {
    method: "POST",
    body: JSON.stringify(sheet ? { url, sheet } : { url }),
  });

export const createSheetSync = (body: {
  spreadsheetId: string;
  sheetTitle: string;
  mapping: Record<string, string>;
  onDuplicate: "skip" | "update";
  keepSyncing: boolean;
}) =>
  api<{ id: string; jobId: string | null }>("/sheet-syncs", {
    method: "POST",
    body: JSON.stringify(body),
  });

export const listSheetSyncs = () => api<SheetSync[]>("/sheet-syncs");

export const runSheetSync = (id: string) =>
  api<{ jobId: string | null }>(`/sheet-syncs/${id}/run`, { method: "POST" });

export const setSheetSyncEnabled = (id: string, enabled: boolean) =>
  api<SheetSync>(`/sheet-syncs/${id}`, {
    method: "PATCH",
    body: JSON.stringify({ enabled }),
  });

export const deleteSheetSync = (id: string) =>
  api<{ deleted: boolean }>(`/sheet-syncs/${id}`, { method: "DELETE" });
