import { api } from "./api";

export interface Template {
  id: string;
  folder_id: string | null;
  name: string;
  subject: string;
  body_html: string;
  body_text: string | null;
  created_at: string;
  updated_at: string;
}

export interface TemplateFolder {
  id: string;
  name: string;
  created_at: string;
}

export interface TemplatePreview {
  subject: string;
  html: string;
  text: string | null;
}

export interface TemplateInput {
  name?: string;
  subject?: string;
  bodyHtml?: string;
  bodyText?: string | null;
  folderId?: string | null;
}

// Personalization tokens available in subject/body. Mirrors the server
// whitelist in apps/api/src/templates/render.ts.
export const TEMPLATE_VARS = [
  "first_name",
  "last_name",
  "company",
  "business_name",
  "title",
  "email",
  "phone",
  "sender_name",
] as const;

const SAMPLE: Record<string, string> = {
  first_name: "Alex",
  last_name: "Rivera",
  company: "Acme Corp",
  business_name: "Acme Corp",
  title: "Head of Growth",
  email: "alex@acme.com",
  phone: "+1 555 0142",
  sender_name: "Jordan Lee",
};

// Client-side live-preview render (sample data). The server endpoint is the
// source of truth for lead-based previews and sending.
export function renderSample(text: string): string {
  return text.replace(/\{(\w+)(?:\|([^}]*))?\}/g, (m, name: string, fb?: string) => {
    if (!(TEMPLATE_VARS as readonly string[]).includes(name)) return m;
    return SAMPLE[name] || (fb ?? "");
  });
}

export const listTemplates = (folderId?: string) =>
  api<Template[]>(
    `/templates${folderId ? `?folderId=${folderId}` : ""}`,
  );

export const getTemplate = (id: string) => api<Template>(`/templates/${id}`);

export const createTemplate = (body: TemplateInput) =>
  api<Template>("/templates", { method: "POST", body: JSON.stringify(body) });

export const updateTemplate = (id: string, body: TemplateInput) =>
  api<Template>(`/templates/${id}`, {
    method: "PATCH",
    body: JSON.stringify(body),
  });

export const deleteTemplate = (id: string) =>
  api<{ deleted: boolean }>(`/templates/${id}`, { method: "DELETE" });

export const duplicateTemplate = (id: string) =>
  api<Template>(`/templates/${id}/duplicate`, { method: "POST" });

export const previewTemplate = (id: string, leadId?: string) =>
  api<TemplatePreview>(`/templates/${id}/preview`, {
    method: "POST",
    body: JSON.stringify(leadId ? { leadId } : {}),
  });

export const testSendTemplate = (id: string, senderId: string, to: string) =>
  api<{ messageId: string; provider: string; from: string }>(
    `/templates/${id}/test`,
    { method: "POST", body: JSON.stringify({ senderId, to }) },
  );

export const listFolders = () => api<TemplateFolder[]>("/templates/folders");

export const createFolder = (name: string) =>
  api<TemplateFolder>("/templates/folders", {
    method: "POST",
    body: JSON.stringify({ name }),
  });

export const deleteFolder = (id: string) =>
  api<{ deleted: boolean }>(`/templates/folders/${id}`, { method: "DELETE" });
