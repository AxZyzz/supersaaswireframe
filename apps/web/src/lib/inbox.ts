import { api } from "./api";

export type ReplyClass =
  | "interested"
  | "not_interested"
  | "question"
  | "out_of_office"
  | "wrong_person"
  | "manual_review";

export const CLASS_META: Record<ReplyClass, { label: string; tone: string }> = {
  interested: { label: "Interested", tone: "bg-success-bg text-success-text" },
  question: { label: "Question", tone: "bg-accent-soft text-accent" },
  not_interested: { label: "Not interested", tone: "bg-neut-bg text-muted" },
  out_of_office: { label: "Out of office", tone: "bg-warning-bg text-warning-text" },
  wrong_person: { label: "Wrong person", tone: "bg-neut-bg text-muted" },
  manual_review: { label: "Needs review", tone: "bg-danger-bg text-danger-text" },
};

export interface ConversationRow {
  id: string;
  subject: string;
  status: "open" | "closed";
  unread: boolean;
  classification: ReplyClass | null;
  confidence: number | null;
  last_message_at: string;
  lead_id: string;
  lead_email: string;
  lead_name: string | null;
  lead_company: string | null;
  campaign_name: string | null;
  snippet: string | null;
}

export interface ThreadMessage {
  direction: "inbound" | "outbound";
  subject: string;
  body_text: string | null;
  from_email: string | null;
  to_email: string | null;
  created_at: string;
  classification: ReplyClass | null;
  confidence: number | null;
}

export interface ConversationDetail {
  id: string;
  subject: string;
  status: "open" | "closed";
  unread: boolean;
  classification: ReplyClass | null;
  confidence: number | null;
  campaign_name: string | null;
  sender_email: string | null;
  thread: ThreadMessage[];
  lead: {
    id: string;
    email: string;
    first_name: string | null;
    last_name: string | null;
    company: string | null;
    title: string | null;
    phone: string | null;
    status: string;
    score: string | null;
  } | null;
  tags: { name: string; color: string }[];
  enrollment: {
    status: string;
    stop_reason: string | null;
    current_step: number;
    next_send_at: string | null;
  } | null;
}

export const listConversations = (p: {
  filter?: string;
  status?: string;
  q?: string;
}) => {
  const qs = new URLSearchParams();
  if (p.filter && p.filter !== "all") qs.set("filter", p.filter);
  if (p.status) qs.set("status", p.status);
  if (p.q) qs.set("q", p.q);
  const s = qs.toString();
  return api<ConversationRow[]>(`/inbox${s ? `?${s}` : ""}`);
};

export const getConversation = (id: string) =>
  api<ConversationDetail>(`/inbox/${id}`);

export const updateConversation = (
  id: string,
  body: Partial<{ unread: boolean; status: "open" | "closed"; classification: ReplyClass }>,
) =>
  api<{ id: string }>(`/inbox/${id}`, {
    method: "PATCH",
    body: JSON.stringify(body),
  });

export const unreadCount = () => api<{ unread: number }>("/inbox/unread-count");

export const simulateReply = (body: {
  fromEmail: string;
  body: string;
  subject?: string;
}) =>
  api<{ conversationId: string; classification: ReplyClass; action: string }>(
    "/inbox/simulate-reply",
    { method: "POST", body: JSON.stringify(body) },
  );
