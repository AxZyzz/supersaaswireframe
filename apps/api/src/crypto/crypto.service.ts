import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

/**
 * AES-256-GCM symmetric encryption for at-rest secrets (SMTP passwords now;
 * OAuth tokens when Gmail/SES sending lands). Key = APP_ENCRYPTION_KEY, a
 * 32-byte value supplied as 64 hex chars. Ciphertext is stored as
 * base64( iv[12] | authTag[16] | ciphertext ), so it round-trips through a
 * single text column with tamper detection built in.
 */
@Injectable()
export class CryptoService {
  private readonly key: Buffer;

  constructor(config: ConfigService) {
    const hex = config.get<string>('APP_ENCRYPTION_KEY') ?? '';
    const key = Buffer.from(hex, 'hex');
    if (key.length !== 32) {
      throw new Error(
        'APP_ENCRYPTION_KEY must be 32 bytes (64 hex chars) for AES-256-GCM',
      );
    }
    this.key = key;
  }

  encrypt(plain: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return Buffer.concat([iv, tag, ct]).toString('base64');
  }

  decrypt(payload: string): string {
    const buf = Buffer.from(payload, 'base64');
    const iv = buf.subarray(0, 12);
    const tag = buf.subarray(12, 28);
    const ct = buf.subarray(28);
    const decipher = createDecipheriv('aes-256-gcm', this.key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ct), decipher.final()]).toString(
      'utf8',
    );
  }
}
