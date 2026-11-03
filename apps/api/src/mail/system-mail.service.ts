import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';

export interface SystemMail {
  to: string;
  subject: string;
  /** Plain-text body (always sent; also the source of the HTML version). */
  text: string;
  /** Optional call-to-action rendered as a button in the HTML version. */
  action?: { label: string; url: string };
}

export interface SentSystemMail extends SystemMail {
  at: Date;
  delivered: boolean;
}

/**
 * The platform's own email (password resets, notification emails, weekly
 * summaries), separate from campaign senders (T1.3 / T7.5).
 *
 * Delivered through one SMTP mailbox configured in env (SYSTEM_SMTP_*), which
 * can be any provider today and Amazon SES's SMTP endpoint later without code
 * changes. When it isn't configured, or EMAIL_DRIVER=mock, mail is not sent:
 * it's logged (outside production, with the full text so a reset link can be
 * copied from the API terminal) and kept in `outbox` for tests.
 */
@Injectable()
export class SystemMailService {
  private readonly log = new Logger('SystemMail');
  private transport: Transporter | null = null;
  /** Last messages handled (newest last); for tests and local debugging. */
  readonly outbox: SentSystemMail[] = [];

  constructor(private readonly config: ConfigService) {}

  private get from() {
    return (
      this.config.get<string>('SYSTEM_EMAIL_FROM') ||
      this.config.get<string>('SYSTEM_SMTP_USER') ||
      'no-reply@localhost'
    );
  }

  /** True when mail will really be delivered. */
  get configured() {
    return (
      this.config.get<string>('EMAIL_DRIVER') !== 'mock' &&
      !!this.config.get<string>('SYSTEM_SMTP_HOST')
    );
  }

  private smtp(): Transporter {
    if (!this.transport) {
      const port = Number(this.config.get<string>('SYSTEM_SMTP_PORT') || 587);
      const secureEnv = this.config.get<string>('SYSTEM_SMTP_SECURE');
      this.transport = nodemailer.createTransport({
        host: this.config.get<string>('SYSTEM_SMTP_HOST'),
        port,
        secure: secureEnv ? secureEnv === 'true' : port === 465,
        auth: this.config.get<string>('SYSTEM_SMTP_USER')
          ? {
              user: this.config.get<string>('SYSTEM_SMTP_USER'),
              pass: this.config.get<string>('SYSTEM_SMTP_PASS'),
            }
          : undefined,
      });
    }
    return this.transport;
  }

  private remember(m: SystemMail, delivered: boolean) {
    this.outbox.push({ ...m, at: new Date(), delivered });
    if (this.outbox.length > 50) this.outbox.shift();
  }

  /**
   * Sends one email. Never throws: a mail outage must not break the action
   * that triggered it (e.g. "forgot password" still answers 200). Returns
   * whether it was delivered.
   */
  async send(m: SystemMail): Promise<boolean> {
    if (!this.configured) {
      this.remember(m, false);
      const dev = this.config.get<string>('NODE_ENV') !== 'production';
      this.log.warn(
        `not sent (SYSTEM_SMTP_HOST not set${
          this.config.get<string>('EMAIL_DRIVER') === 'mock'
            ? ' / EMAIL_DRIVER=mock'
            : ''
        }): "${m.subject}" to ${m.to}` +
          (dev
            ? `\n${m.text}${m.action ? `\n${m.action.label}: ${m.action.url}` : ''}`
            : ''),
      );
      return false;
    }
    try {
      await this.smtp().sendMail({
        from: this.from,
        to: m.to,
        subject: m.subject,
        text: m.action
          ? `${m.text}\n\n${m.action.label}: ${m.action.url}\n`
          : m.text,
        html: renderHtml(m),
      });
      this.remember(m, true);
      return true;
    } catch (err) {
      this.remember(m, false);
      this.log.error(
        `failed: "${m.subject}" to ${m.to}: ${err instanceof Error ? err.message : String(err)}`,
      );
      return false;
    }
  }
}

const esc = (s: string) =>
  s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

/** Minimal, client-safe HTML version of a system email. */
export function renderHtml(m: SystemMail): string {
  const paras = m.text
    .split(/\n{2,}/)
    .map(
      (p) => `<p style="margin:0 0 14px">${esc(p).replace(/\n/g, '<br>')}</p>`,
    )
    .join('');
  const button = m.action
    ? `<p style="margin:20px 0"><a href="${esc(m.action.url)}" style="background:#3E63DD;color:#fff;padding:10px 16px;border-radius:6px;text-decoration:none;display:inline-block">${esc(m.action.label)}</a></p>`
    : '';
  return `<div style="font-family:Inter,Arial,sans-serif;font-size:14px;line-height:1.5;color:#1c2024;max-width:560px">${paras}${button}</div>`;
}
