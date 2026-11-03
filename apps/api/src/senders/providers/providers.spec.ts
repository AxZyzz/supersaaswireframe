import { ConfigService } from '@nestjs/config';
import type { SenderRow } from '../senders.service';
import { MockProvider } from './mock.provider';
import { NotConfiguredProvider } from './notconfigured.provider';
import { ProviderResolver } from './provider.resolver';
import { SmtpProvider } from './smtp.provider';

const row = (provider: SenderRow['provider']): SenderRow => ({
  id: 'x',
  provider,
  from_name: 'Acme',
  from_email: 'a@b.com',
  reply_to: null,
  signature: null,
  daily_limit: 50,
  send_window_start: null,
  send_window_end: null,
  status: 'unverified',
  created_at: new Date(),
  updated_at: new Date(),
  warmup_enabled: true,
  warmup_started_at: new Date(),
  effective_daily_limit: 20,
  warmup_day: 1,
});

const resolver = (emailDriver?: string) =>
  new ProviderResolver({
    get: (k: string) => (k === 'EMAIL_DRIVER' ? emailDriver : undefined),
  } as unknown as ConfigService);

const SMTP = {
  host: 'smtp.example.com',
  port: 587,
  secure: false,
  user: 'u',
  pass: 'p',
};

describe('ProviderResolver', () => {
  it('dispatches smtp with config to a real SmtpProvider', () => {
    const p = resolver().resolve(row('smtp'), { smtp: SMTP });
    expect(p).toBeInstanceOf(SmtpProvider);
    expect(p.provider).toBe('smtp');
  });

  it('returns NotConfigured for smtp with no config', () => {
    const p = resolver().resolve(row('smtp'), {});
    expect(p).toBeInstanceOf(NotConfiguredProvider);
  });

  it('returns NotConfigured for ses and gmail (creds not wired)', () => {
    expect(resolver().resolve(row('ses'), {})).toBeInstanceOf(
      NotConfiguredProvider,
    );
    expect(resolver().resolve(row('gmail'), {})).toBeInstanceOf(
      NotConfiguredProvider,
    );
  });

  it('EMAIL_DRIVER=mock overrides every provider with the mock backend', () => {
    for (const prov of ['ses', 'gmail', 'smtp'] as const) {
      expect(
        resolver('mock').resolve(row(prov), { smtp: SMTP }),
      ).toBeInstanceOf(MockProvider);
    }
  });
});

describe('MockProvider', () => {
  it('verifies OK and returns a mock messageId on send', async () => {
    const m = new MockProvider('smtp');
    expect((await m.verify()).ok).toBe(true);
    const res = await m.send({ to: 'x@y.com', subject: 'hi' });
    expect(res.messageId).toMatch(/^mock-/);
    expect(res.provider).toBe('mock:smtp');
  });
});

describe('NotConfiguredProvider', () => {
  it('verify() reports the reason and send() rejects', async () => {
    const n = new NotConfiguredProvider('ses', 'needs AWS');
    const v = await n.verify();
    expect(v.ok).toBe(false);
    expect(v.detail).toBe('needs AWS');
    await expect(n.send()).rejects.toThrow(/not configured/);
  });
});
