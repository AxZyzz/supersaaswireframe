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

const FONT =
  "font-family:Inter,-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;";

/**
 * HTML version of a system email in the app's light theme (same look as the
 * starter templates): grey canvas, white card, SuperSaaS header, indigo
 * button, quiet footer. Email-safe: tables + inline styles only.
 */
export function renderHtml(m: SystemMail): string {
  const paras = m.text
    .split(/\n{2,}/)
    .map(
      (p) =>
        `<p style="${FONT}margin:0 0 14px;font-size:15px;line-height:1.6;color:#333333;">${esc(p).replace(/\n/g, '<br>')}</p>`,
    )
    .join('');
  const button = m.action
    ? `<div style="margin:22px 0 6px;"><a href="${esc(m.action.url)}" style="${FONT}display:inline-block;background:#3e63dd;color:#ffffff;text-decoration:none;font-size:15px;font-weight:600;line-height:20px;padding:11px 22px;border-radius:6px;">${esc(m.action.label)}</a></div>` +
      `<p style="${FONT}margin:14px 0 0;font-size:12px;line-height:1.5;color:#818181;">Button not working? Paste this link into your browser:<br><span style="color:#3e63dd;word-break:break-all;">${esc(m.action.url)}</span></p>`
    : '';
  return (
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f7f7f8;"><tr><td align="center" style="padding:24px 12px;">` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:520px;background:#ffffff;border:1px solid #ebebeb;border-radius:10px;"><tr><td style="padding:28px 32px;">` +
    `<div style="${FONT}margin:0 0 20px;font-size:14px;font-weight:700;color:#3e63dd;"><span style="display:inline-block;width:22px;height:22px;line-height:22px;text-align:center;border-radius:5px;background:#3e63dd;color:#ffffff;font-size:10px;margin-right:8px;">SS</span>SuperSaaS</div>` +
    paras +
    button +
    `</td></tr></table>` +
    `<p style="${FONT}margin:16px 0 0;font-size:12px;line-height:1.5;color:#818181;">Sent by SuperSaaS · A2B AI Technologies</p>` +
    `</td></tr></table>`
  );
}
