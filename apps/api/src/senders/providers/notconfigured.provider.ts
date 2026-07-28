import { EmailProvider, SendResult, VerifyResult } from './email-provider';

/**
 * Stands in for a provider whose integration isn't wired yet (SES needs AWS
 * credentials → E3.2; Gmail needs Google OAuth → E3.3). verify() reports the
 * reason so the UI can guide the user; send() rejects so nothing silently
 * drops a message. (send() takes no arg — structurally satisfies the
 * EmailProvider.send(msg) signature without an unused parameter.)
 */
export class NotConfiguredProvider implements EmailProvider {
  constructor(
    readonly provider: string,
    private readonly reason: string,
  ) {}

  verify(): Promise<VerifyResult> {
    return Promise.resolve({ ok: false, detail: this.reason });
  }

  send(): Promise<SendResult> {
    return Promise.reject(
      new Error(`${this.provider} sending not configured: ${this.reason}`),
    );
  }
}
