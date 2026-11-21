import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  CronAuthGuard,
  type CronTokenVerifier,
  type VerifiedToken,
} from './cron-auth.guard';

const SA = 'expelly-scheduler@proj.iam.gserviceaccount.com';
const AUD = 'https://supersaas-api.example.run.app';

const ctx = (headers: Record<string, string>) =>
  ({
    switchToHttp: () => ({ getRequest: () => ({ headers }) }),
  }) as unknown as ExecutionContext;

const guard = (
  verify: (t: string, a: string[]) => VerifiedToken | null,
  cfg: Record<string, string> = { CRON_AUDIENCE: AUD, CRON_SA_EMAIL: SA },
) => {
  const verifier: CronTokenVerifier = {
    verify: (t, a) => Promise.resolve(verify(t, a)),
  };
  return new CronAuthGuard(new ConfigService(cfg), verifier);
};

describe('CronAuthGuard (T13)', () => {
  const env = process.env.NODE_ENV;
  afterEach(() => {
    process.env.NODE_ENV = env;
  });

  it('accepts only the scheduler service account with a token made for this API', async () => {
    const seen: string[][] = [];
    const g = guard((t, a) => {
      seen.push(a);
      return t === 'good'
        ? { email: SA.toUpperCase(), emailVerified: true }
        : null;
    });
    await expect(
      g.canActivate(ctx({ authorization: 'Bearer good' })),
    ).resolves.toBe(true);
    expect(seen[0]).toEqual([AUD]);
  });

  it('refuses a missing, malformed, unverifiable or foreign token (401)', async () => {
    const g = guard((t) =>
      t === 'other-sa'
        ? { email: 'someone@else.com', emailVerified: true }
        : t === 'unverified'
          ? { email: SA, emailVerified: false }
          : null,
    );
    for (const headers of [
      {},
      { authorization: '' },
      { authorization: 'Basic abc' },
      { authorization: 'Bearer ' },
      { authorization: 'Bearer forged' },
      { authorization: 'Bearer other-sa' },
      { authorization: 'Bearer unverified' },
    ] as Record<string, string>[]) {
      await expect(g.canActivate(ctx(headers))).rejects.toThrow(
        UnauthorizedException,
      );
    }
  });

  it('refuses everything when the audience or the service account is not configured', async () => {
    const good = () => ({ email: SA, emailVerified: true });
    for (const cfg of [
      {},
      { CRON_AUDIENCE: AUD },
      { CRON_SA_EMAIL: SA },
    ] as Record<string, string>[]) {
      await expect(
        guard(good, cfg).canActivate(ctx({ authorization: 'Bearer good' })),
      ).rejects.toThrow(UnauthorizedException);
    }
  });

  it('the dev secret works only when NODE_ENV=development, and only the exact value', async () => {
    const cfg = {
      CRON_DEV_SECRET: 's3cret-value',
      CRON_AUDIENCE: AUD,
      CRON_SA_EMAIL: SA,
    };
    const g = guard(() => null, cfg);
    process.env.NODE_ENV = 'development';
    await expect(
      g.canActivate(ctx({ 'x-cron-secret': 's3cret-value' })),
    ).resolves.toBe(true);
    await expect(
      g.canActivate(ctx({ 'x-cron-secret': 's3cret-valuE' })),
    ).rejects.toThrow(UnauthorizedException);
    await expect(g.canActivate(ctx({ 'x-cron-secret': '' }))).rejects.toThrow(
      UnauthorizedException,
    );
    for (const mode of ['production', 'test', undefined]) {
      process.env.NODE_ENV = mode;
      await expect(
        g.canActivate(ctx({ 'x-cron-secret': 's3cret-value' })),
      ).rejects.toThrow(UnauthorizedException);
    }
  });
});
