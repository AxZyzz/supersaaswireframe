import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { SenderRow } from '../senders.service';
import { EmailProvider } from './email-provider';
import { MockProvider } from './mock.provider';
import { NotConfiguredProvider } from './notconfigured.provider';
import { SmtpConfig, SmtpProvider } from './smtp.provider';

/** Sender secrets after decryption, keyed by provider. */
export interface DecryptedSenderConfig {
  smtp?: SmtpConfig;
}

/**
 * Maps a sender_accounts row + its decrypted config to a concrete
 * EmailProvider. EMAIL_DRIVER=mock forces the mock backend for every sender
 * (local dev without real SMTP). Otherwise: smtp → real nodemailer; ses/gmail
 * → not-configured until their credentials land (E3.2 / E3.3).
 */
@Injectable()
export class ProviderResolver {
  constructor(private readonly config: ConfigService) {}

  resolve(sender: SenderRow, cfg: DecryptedSenderConfig): EmailProvider {
    if (this.config.get<string>('EMAIL_DRIVER') === 'mock') {
      return new MockProvider(sender.provider);
    }
    switch (sender.provider) {
      case 'smtp':
        if (!cfg.smtp) {
          return new NotConfiguredProvider(
            'smtp',
            'SMTP host and credentials are not set on this sender.',
          );
        }
        return new SmtpProvider(
          cfg.smtp,
          sender.from_email,
          sender.from_name,
          sender.reply_to,
        );
      case 'ses':
        return new NotConfiguredProvider(
          'ses',
          'Amazon SES sending activates once AWS credentials are configured (E3.2 / E5).',
        );
      case 'gmail':
        return new NotConfiguredProvider(
          'gmail',
          'Gmail sending activates once Google OAuth is connected (E3.3 / E5).',
        );
      default:
        return new NotConfiguredProvider(sender.provider, 'Unknown provider.');
    }
  }
}
