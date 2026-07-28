import * as nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';
import type SMTPTransport from 'nodemailer/lib/smtp-transport';
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
 */
export class SmtpProvider implements EmailProvider {
  readonly provider = 'smtp';
  private readonly transport: Transporter<SMTPTransport.SentMessageInfo>;

  constructor(
    private readonly cfg: SmtpConfig,
    private readonly from: string,
    private readonly fromName?: string,
    private readonly replyTo?: string | null,
  ) {
    this.transport = nodemailer.createTransport({
      host: cfg.host,
      port: cfg.port,
      secure: cfg.secure,
      auth: { user: cfg.user, pass: cfg.pass },
    });
  }

  async verify(): Promise<VerifyResult> {
    try {
      await this.transport.verify();
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
    const info = await this.transport.sendMail({
      from: this.fromName ? `"${this.fromName}" <${this.from}>` : this.from,
      to: msg.to,
      subject: msg.subject,
      html: msg.html,
      text: msg.text,
      replyTo: this.replyTo ?? undefined,
    });
    return { messageId: info.messageId, provider: this.provider };
  }
}
