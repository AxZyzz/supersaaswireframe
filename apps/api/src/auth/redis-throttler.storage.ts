import { Injectable, Logger, Module, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { ThrottlerStorage } from '@nestjs/throttler';
import { randomUUID } from 'crypto';
import Redis from 'ioredis';

// One round trip, atomic: bump the window counter, start its TTL on the first
// hit, and open a block window once the limit is passed.
// KEYS[1]=hits KEYS[2]=block  ARGV[1]=ttl ms  ARGV[2]=limit  ARGV[3]=block ms
const INCREMENT = `
local hits = redis.call('INCR', KEYS[1])
if hits == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[1]) end
local ttl = redis.call('PTTL', KEYS[1])
local blocked = redis.call('PTTL', KEYS[2])
if blocked <= 0 and hits > tonumber(ARGV[2]) then
  redis.call('SET', KEYS[2], '1', 'PX', ARGV[3])
  blocked = tonumber(ARGV[3])
end
if blocked < 0 then blocked = 0 end
if ttl < 0 then ttl = 0 end
return {hits, ttl, blocked}
`;

/**
 * Rate-limit counters in Redis so every API instance shares one budget per
 * client (T1.3) — the default in-memory store resets per process and lets a
 * client multiply its limit by the instance count.
 *
 * Fails open: if Redis is unreachable the request is allowed and the error
 * logged, so a cache outage never takes the API down with it.
 */
@Injectable()
export class RedisThrottlerStorage
  implements ThrottlerStorage, OnModuleDestroy
{
  private readonly logger = new Logger(RedisThrottlerStorage.name);
  private readonly redis: Redis;
  private readonly prefix: string;

  constructor(config: ConfigService) {
    this.redis = new Redis(
      config.get<string>('REDIS_URL', 'redis://localhost:6379'),
      // short timeout: a slow or down Redis fails open quickly instead of
      // stalling every request behind it
      { maxRetriesPerRequest: 1, commandTimeout: 500 },
    );
    this.redis.on('error', (e: Error) =>
      this.logger.warn(`throttler redis: ${e.message}`),
    );
    // Test suites each boot their own app against one Redis; namespacing per
    // instance keeps their budgets independent, like the in-memory store did.
    this.prefix =
      process.env.NODE_ENV === 'test'
        ? `throttle:${randomUUID()}:`
        : 'throttle:';
  }

  async increment(
    key: string,
    ttl: number,
    limit: number,
    blockDuration: number,
    throttlerName: string,
  ) {
    const base = `${this.prefix}${throttlerName}:${key}`;
    try {
      const [hits, ttlMs, blockMs] = (await this.redis.eval(
        INCREMENT,
        2,
        `${base}:hits`,
        `${base}:block`,
        ttl,
        limit,
        blockDuration || ttl,
      )) as [number, number, number];
      return {
        totalHits: hits,
        timeToExpire: Math.ceil(ttlMs / 1000),
        isBlocked: blockMs > 0,
        timeToBlockExpire: Math.ceil(blockMs / 1000),
      };
    } catch (e) {
      this.logger.warn(`throttler fail-open: ${(e as Error).message}`);
      return {
        totalHits: 0,
        timeToExpire: Math.ceil(ttl / 1000),
        isBlocked: false,
        timeToBlockExpire: 0,
      };
    }
  }

  async onModuleDestroy() {
    await this.redis.quit().catch(() => this.redis.disconnect());
  }
}

@Module({
  providers: [RedisThrottlerStorage],
  exports: [RedisThrottlerStorage],
})
export class ThrottlerStorageModule {}
