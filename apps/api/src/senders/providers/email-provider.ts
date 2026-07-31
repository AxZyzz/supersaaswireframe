// The single surface every sending backend implements. The E5 sending engine
// targets this interface only — it never imports a provider SDK directly, so
// SES / Gmail / SMTP / mock are interchangeable behind it.

export interface EmailMessage {
  to: string;
  subject: string;
  html?: string;
  text?: string;
  // Extra SMTP headers (e.g. List-Unsubscribe). Ignored by the mock provider.
  headers?: Record<string, string>;
}

export interface SendResult {
  messageId: string;
  provider: string;
}

export interface VerifyResult {
  ok: boolean;
  detail: string;
}

export interface EmailProvider {
  readonly provider: string;
  /** Check the backend is reachable + authenticated. No message is sent. */
  verify(): Promise<VerifyResult>;
  /** Deliver one message. */
  send(msg: EmailMessage): Promise<SendResult>;
}
