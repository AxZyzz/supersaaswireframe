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
  private readonly logger = new Logger(MockProvider.name);

  constructor(readonly provider: string = 'mock') {}

  verify(): Promise<VerifyResult> {
    return Promise.resolve({ ok: true, detail: 'Mock provider — always OK' });
  }

  send(msg: EmailMessage): Promise<SendResult> {
    const messageId = `mock-${randomUUID()}`;
    this.logger.log(
      `[mock:${this.provider}] → ${msg.to} :: ${msg.subject} (${messageId})`,
    );
    return Promise.resolve({ messageId, provider: `mock:${this.provider}` });
  }
}
