import { ConfigService } from '@nestjs/config';
import { CryptoService } from './crypto.service';

const KEY = 'a54943354b7cc9f07535891d87ac091485da4d1c7830e47cef9070110de0b42d';

function make(key = KEY): CryptoService {
  const config = { get: () => key } as unknown as ConfigService;
  return new CryptoService(config);
}

describe('CryptoService (AES-256-GCM)', () => {
  it('round-trips a secret', () => {
    const c = make();
    const secret = 'smtp-p@ssw0rd-🔐';
    const enc = c.encrypt(secret);
    expect(enc).not.toContain(secret);
    expect(c.decrypt(enc)).toBe(secret);
  });

  it('produces a fresh IV each call (ciphertexts differ)', () => {
    const c = make();
    expect(c.encrypt('same')).not.toBe(c.encrypt('same'));
  });

  it('rejects a tampered ciphertext (auth tag mismatch)', () => {
    const c = make();
    const buf = Buffer.from(c.encrypt('hunter2'), 'base64');
    buf[buf.length - 1] ^= 0xff; // flip a ciphertext byte
    expect(() => c.decrypt(buf.toString('base64'))).toThrow();
  });

  it('throws when the key is not 32 bytes', () => {
    expect(() => make('deadbeef')).toThrow(/32 bytes/);
  });
});
