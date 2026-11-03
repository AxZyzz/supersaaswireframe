import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';
import { RedisThrottlerStorage } from './redis-throttler.storage';

/** T1.3: rate-limit counters live in Redis, so API instances share them. */
describe('RedisThrottlerStorage', () => {
  const env = process.env.NODE_ENV;
  let a: RedisThrottlerStorage;
  let b: RedisThrottlerStorage;

  beforeAll(() => {
    // same namespace for both, as in production (two servers, one Redis)
    process.env.NODE_ENV = 'production-like';
    const config = new ConfigService({
      REDIS_URL: process.env.REDIS_URL ?? 'redis://localhost:6379',
    });
    a = new RedisThrottlerStorage(config);
    b = new RedisThrottlerStorage(config);
    process.env.NODE_ENV = env;
  });

  afterAll(async () => {
    await a.onModuleDestroy();
    await b.onModuleDestroy();
  });

  it('counts hits across instances and blocks past the limit', async () => {
    const key = `spec-${randomUUID()}`;
    const r1 = await a.increment(key, 2_000, 3, 0, 'default');
    expect(r1).toMatchObject({ totalHits: 1, isBlocked: false });
    expect(r1.timeToExpire).toBeGreaterThan(0);
    await b.increment(key, 2_000, 3, 0, 'default');
    const r3 = await a.increment(key, 2_000, 3, 0, 'default');
    expect(r3).toMatchObject({ totalHits: 3, isBlocked: false });
    const r4 = await b.increment(key, 2_000, 3, 0, 'default');
    expect(r4.totalHits).toBe(4);
    expect(r4.isBlocked).toBe(true);
    expect(r4.timeToBlockExpire).toBeGreaterThan(0);
  });

  it('keeps throttlers and keys independent', async () => {
    const key = `spec-${randomUUID()}`;
    await a.increment(key, 2_000, 1, 0, 'default');
    const other = await a.increment(key, 2_000, 1, 0, 'burst');
    expect(other).toMatchObject({ totalHits: 1, isBlocked: false });
  });

  it('window expires and the count resets', async () => {
    const key = `spec-${randomUUID()}`;
    await a.increment(key, 300, 1, 300, 'default');
    expect((await a.increment(key, 300, 1, 300, 'default')).isBlocked).toBe(
      true,
    );
    await new Promise((r) => setTimeout(r, 450));
    expect(await a.increment(key, 300, 1, 300, 'default')).toMatchObject({
      totalHits: 1,
      isBlocked: false,
    });
  });
});
