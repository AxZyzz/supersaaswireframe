import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { CronTokenVerifier } from '../internal/cron-auth.guard';
import { AgentToolAuthGuard } from './agent-tools.controller';

const SA = 'discover-agent@proj.iam.gserviceaccount.com';
const AUD = 'https://api.example.run.app';

const ctx = (headers: Record<string, string>) =>
  ({
    switchToHttp: () => ({ getRequest: () => ({ headers }) }),
  }) as unknown as ExecutionContext;

const guard = (
  cfg: Record<string, string>,
  verify: CronTokenVerifier['verify'] = () => Promise.resolve(null),
) => new AgentToolAuthGuard(new ConfigService(cfg), { verify });

describe('AgentToolAuthGuard (T10)', () => {
  const env = process.env.NODE_ENV;
  afterEach(() => {
    process.env.NODE_ENV = env;
  });

  const full = { AGENT_TOOLS_AUDIENCE: AUD, AGENT_TOOLS_SA_EMAIL: SA };

  it('accepts only the Discover agent account with an ID token made for this API', async () => {
    const seen: string[][] = [];
    const g = guard(full, (t, a) => {
      seen.push(a);
      return Promise.resolve(
        t === 'good' ? { email: SA.toUpperCase(), emailVerified: true } : null,
      );
    });
    await expect(
      g.canActivate(ctx({ authorization: 'Bearer good' })),
    ).resolves.toBe(true);
    expect(seen[0]).toEqual([AUD]);
    for (const headers of [
      {},
      { authorization: 'Bearer forged' },
      { authorization: 'Basic abc' },
    ] as Record<string, string>[]) {
      await expect(g.canActivate(ctx(headers))).rejects.toThrow(
        UnauthorizedException,
      );
    }
  });

  it('refuses a verified token of another account, an unverified email, and a half-configured API', async () => {
    const other = guard(full, () =>
      Promise.resolve({ email: 'someone@else.com', emailVerified: true }),
    );
    await expect(
      other.canActivate(ctx({ authorization: 'Bearer x' })),
    ).rejects.toThrow(UnauthorizedException);
    const unverified = guard(full, () =>
      Promise.resolve({ email: SA, emailVerified: false }),
    );
    await expect(
      unverified.canActivate(ctx({ authorization: 'Bearer x' })),
    ).rejects.toThrow(UnauthorizedException);
    for (const cfg of [
      {},
      { AGENT_TOOLS_AUDIENCE: AUD },
      { AGENT_TOOLS_SA_EMAIL: SA },
    ]) {
      const g = guard(cfg as Record<string, string>, () =>
        Promise.resolve({ email: SA, emailVerified: true }),
      );
      await expect(
        g.canActivate(ctx({ authorization: 'Bearer x' })),
      ).rejects.toThrow(UnauthorizedException);
    }
  });

  it('the dev secret works only when NODE_ENV=development, and only the exact value', async () => {
    const g = guard({ ...full, AGENT_TOOLS_DEV_SECRET: 'agent-dev-secret' });
    process.env.NODE_ENV = 'development';
    await expect(
      g.canActivate(ctx({ 'x-agent-secret': 'agent-dev-secret' })),
    ).resolves.toBe(true);
    await expect(
      g.canActivate(ctx({ 'x-agent-secret': 'agent-dev-secreT' })),
    ).rejects.toThrow(UnauthorizedException);
    for (const mode of ['production', 'test', undefined]) {
      process.env.NODE_ENV = mode;
      await expect(
        g.canActivate(ctx({ 'x-agent-secret': 'agent-dev-secret' })),
      ).rejects.toThrow(UnauthorizedException);
    }
  });
});
