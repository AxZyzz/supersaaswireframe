import { api } from "./api";

export interface Sender {
  id: string;
  provider: "ses" | "gmail" | "smtp";
  from_name: string;
  from_email: string;
  reply_to: string | null;
  signature: string | null;
  daily_limit: number;
  effective_daily_limit: number;
  warmup_enabled: boolean;
  warmup_day: number | null;
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

export interface SmtpConfig {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  pass: string;
}

export interface VerifyResult {
  ok: boolean;
  status: string;
  detail: string;
}

export const listSenders = () => api<Sender[]>("/senders");

export const createSender = (body: {
  provider: "ses" | "gmail" | "smtp";
  fromName: string;
  fromEmail: string;
  replyTo?: string;
  dailyLimit?: number;
  smtp?: SmtpConfig;
}) => api<Sender>("/senders", { method: "POST", body: JSON.stringify(body) });

export const deleteSender = (id: string) =>
  api<{ deleted: boolean }>(`/senders/${id}`, { method: "DELETE" });

export const verifySender = (id: string) =>
  api<VerifyResult>(`/senders/${id}/verify`, { method: "POST" });

export const testSender = (id: string, to: string) =>
  api<{ sent: boolean; messageId: string; provider: string }>(
    `/senders/${id}/test`,
    { method: "POST", body: JSON.stringify({ to }) },
  );

export const dnsCheck = (domain: string) =>
  api<DnsCheckResult>(`/senders/dns-check?domain=${encodeURIComponent(domain)}`);

export const updateSender = (
  id: string,
  body: Partial<{ warmupEnabled: boolean; restartWarmup: boolean; dailyLimit: number }>,
) =>
  api<Sender>(`/senders/${id}`, { method: "PATCH", body: JSON.stringify(body) });
