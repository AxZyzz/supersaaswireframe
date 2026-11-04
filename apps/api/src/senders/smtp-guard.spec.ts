import { BadRequestException } from '@nestjs/common';
import {
  assertSmtpTarget,
  isInternalAddress,
  resolveSmtpHost,
} from './smtp-guard';

describe('SMTP SSRF guard', () => {
  afterEach(() => delete process.env.SMTP_ALLOW_PRIVATE_HOSTS);

  it.each([
    '127.0.0.1',
    '10.1.2.3',
    '172.16.0.9',
    '172.31.255.255',
    '192.168.1.1',
    '169.254.169.254',
    '100.64.0.1',
    '0.0.0.0',
    '224.0.0.1',
    '255.255.255.255',
    '::1',
    '::',
    'fe80::1',
    'fd00::1',
    '::ffff:127.0.0.1',
    '::ffff:10.0.0.1',
  ])('treats %s as internal', (ip) => {
    expect(isInternalAddress(ip)).toBe(true);
  });

  it.each([
    '8.8.8.8',
    '172.32.0.1',
    '142.250.72.5',
    '2607:f8b0:4005:80a::200e',
  ])('treats %s as public', (ip) => expect(isInternalAddress(ip)).toBe(false));

  it('only allows mail ports', () => {
    expect(() => assertSmtpTarget('smtp.example.com', 6379)).toThrow(
      BadRequestException,
    );
    expect(() => assertSmtpTarget('smtp.example.com', 80)).toThrow(
      /25, 465, 587, 2525/,
    );
    expect(() => assertSmtpTarget('smtp.example.com', 587)).not.toThrow();
  });

  it('refuses internal literals and localhost at save time', () => {
    for (const h of [
      '127.0.0.1',
      '169.254.169.254',
      'localhost',
      'mail.localhost',
      '::1',
    ]) {
      expect(() => assertSmtpTarget(h, 587)).toThrow(/public mail server/);
    }
  });

  it('refuses an internal address at connect time (incl. after DNS)', async () => {
    await expect(resolveSmtpHost('10.0.0.5', 587)).rejects.toThrow(
      /public mail server/,
    );
    // "localhost" resolves to 127.0.0.1 / ::1 even with no outside DNS
    await expect(resolveSmtpHost('localhost', 25)).rejects.toThrow();
    await expect(resolveSmtpHost('8.8.8.8', 587)).resolves.toBe('8.8.8.8');
  });

  it('SMTP_ALLOW_PRIVATE_HOSTS=on lifts the address rule, not the port rule', async () => {
    process.env.SMTP_ALLOW_PRIVATE_HOSTS = 'on';
    expect(() => assertSmtpTarget('127.0.0.1', 587)).not.toThrow();
    expect(() => assertSmtpTarget('127.0.0.1', 6379)).toThrow(/port/);
    await expect(resolveSmtpHost('127.0.0.1', 2525)).resolves.toBe('127.0.0.1');
  });
});
