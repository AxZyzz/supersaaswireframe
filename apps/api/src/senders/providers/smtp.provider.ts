import * as nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';
import type SMTPTransport from 'nodemailer/lib/smtp-transport';
import { resolveSmtpHost } from '../smtp-guard';
import {
  EmailMessage,
  EmailProvider,
  SendResult,
  VerifyResult,
} from './email-provider';

export interface SmtpConfig {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  pass: string;
}

/**
 * Real SMTP backend via nodemailer. Buildable and testable against any SMTP
 * server (Mailtrap, Ethereal, self-hosted) with no cloud account — which is
 * why it's the first concrete provider we wire.
 *
 * Every connection goes through the SSRF guard (smtp-guard.ts): the host is
 * resolved and checked first, then nodemailer connects to that vetted IP with
 * TLS still verifying the original hostname.
 */
export class SmtpProvider implements EmailProvider {
  readonly provider = 'smtp';

  constructor(
    private readonly cfg: SmtpConfig,
    private readonly from: string,
    private readonly fromName?: string,
    private readonly replyTo?: string | null,
  ) {}

  private async transport(): Promise<
    Transporter<SMTPTransport.SentMessageInfo>
  > {
    const ip = await resolveSmtpHost(this.cfg.host, this.cfg.port);
    return nodemailer.createTransport({
      host: ip,
      port: this.cfg.port,
      secure: this.cfg.secure,
      tls: { servername: this.cfg.host },
      auth: { user: this.cfg.user, pass: this.cfg.pass },
    });
  }

  async verify(): Promise<VerifyResult> {
    try {
      await (await this.transport()).verify();
      return {
        ok: true,
        detail: `Connected to ${this.cfg.host}:${this.cfg.port}`,
      };
    } catch (err) {
      return {
        ok: false,
        detail: err instanceof Error ? err.message : 'SMTP connection failed',
      };
    }
  }

  async send(msg: EmailMessage): Promise<SendResult> {
    const info = await (
      await this.transport()
    ).sendMail({
      // Structured address: a crafted display name can't add recipients or
      // break the From header (it's quoted/encoded by nodemailer).
      from: this.fromName
        ? { name: this.fromName, address: this.from }
        : this.from,
      to: msg.to,
      subject: msg.subject,
      html: msg.html,
      text: msg.text,
      replyTo: this.replyTo ?? undefined,
      headers: msg.headers,
    });
    return { messageId: info.messageId, provider: this.provider };
  }
}
