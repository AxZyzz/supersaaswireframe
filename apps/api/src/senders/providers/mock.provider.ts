import { Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import {
  EmailMessage,
  EmailProvider,
  SendResult,
  VerifyResult,
} from './email-provider';

/**
 * Dev/test backend. Logs instead of sending, so the E5 sending engine can run
 * end to end before any real provider credentials exist. Force it for every
 * sender with EMAIL_DRIVER=mock.
 */
export class MockProvider implements EmailProvider {
  /** Last messages "sent" (newest last, capped) — for tests and dev checks. */
  static readonly outbox: EmailMessage[] = [];
  private readonly logger = new Logger(MockProvider.name);

  constructor(readonly provider: string = 'mock') {}

  verify(): Promise<VerifyResult> {
    return Promise.resolve({ ok: true, detail: 'Mock provider — always OK' });
  }

  send(msg: EmailMessage): Promise<SendResult> {
    const messageId = `mock-${randomUUID()}`;
    MockProvider.outbox.push(msg);
    if (MockProvider.outbox.length > 50) MockProvider.outbox.shift();
    this.logger.log(
      `[mock:${this.provider}] → ${msg.to} :: ${msg.subject} (${messageId})`,
    );
    return Promise.resolve({ messageId, provider: `mock:${this.provider}` });
  }
}
