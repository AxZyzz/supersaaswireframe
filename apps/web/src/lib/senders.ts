import { api } from "./api";

export interface Sender {
  id: string;
  provider: "ses" | "gmail" | "smtp";
  from_name: string;
  from_email: string;
  reply_to: string | null;
  signature: string | null;
  daily_limit: number;
  send_window_start: number | null;
  send_window_end: number | null;
  status: string;
  created_at: string;
  updated_at: string;
}

export interface DnsRecordCheck {
  found: boolean;
  record: string | null;
  detail: string;
}
export interface DnsCheckResult {
  domain: string;
  spf: DnsRecordCheck;
  dmarc: DnsRecordCheck;
  dkim: DnsRecordCheck;
}

export const listSenders = () => api<Sender[]>("/senders");

export const createSender = (body: {
  provider: "ses" | "gmail" | "smtp";
  fromName: string;
  fromEmail: string;
  replyTo?: string;
  dailyLimit?: number;
}) => api<Sender>("/senders", { method: "POST", body: JSON.stringify(body) });

export const deleteSender = (id: string) =>
  api<{ deleted: boolean }>(`/senders/${id}`, { method: "DELETE" });

export const dnsCheck = (domain: string) =>
  api<DnsCheckResult>(`/senders/dns-check?domain=${encodeURIComponent(domain)}`);
