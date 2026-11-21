import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

// Per-model circuit breaker. ≥3 failures (timeout, 429, 503) inside 2 minutes
// opens the circuit for 5 minutes. State lives in Redis so every Cloud Run
// instance agrees; each instance caches open/closed in memory for 15 s so the
// happy path costs about one EXISTS per model per 15 s. A failure costs one
// INCR + (first failure only) one EXPIRE, plus one SET when it trips.
export const FAILURE_THRESHOLD = 3;
export const FAILURE_WINDOW_SEC = 120;
export const OPEN_SEC = 300;
export const STATE_CACHE_MS = 15_000;

export interface CircuitStore {
  /** Count one failure; true when this failure tripped the circuit. */
  recordFailure(model: string): Promise<boolean>;
  isOpen(model: string): Promise<boolean>;
}

export class MemoryCircuitStore implements CircuitStore {
  private fails = new Map<string, number[]>();
  private openUntil = new Map<string, number>();
  constructor(private readonly now: () => number = Date.now) {}

  recordFailure(model: string): Promise<boolean> {
    const t = this.now();
    const recent = (this.fails.get(model) ?? []).filter(
      (x) => t - x < FAILURE_WINDOW_SEC * 1000,
    );
    recent.push(t);
    this.fails.set(model, recent);
    if (recent.length >= FAILURE_THRESHOLD && !this.alreadyOpen(model, t)) {
      this.openUntil.set(model, t + OPEN_SEC * 1000);
      return Promise.resolve(true);
    }
    return Promise.resolve(false);
  }

  isOpen(model: string): Promise<boolean> {
    return Promise.resolve(this.alreadyOpen(model, this.now()));
  }

  private alreadyOpen(model: string, t: number) {
    return (this.openUntil.get(model) ?? 0) > t;
  }
}

export class RedisCircuitStore implements CircuitStore {
  private readonly logger = new Logger(RedisCircuitStore.name);
  private redis: Redis | null = null;

  constructor(private readonly config: ConfigService) {}

  private client(): Redis {
    if (!this.redis) {
      this.redis = new Redis(
        this.config.get<string>('REDIS_URL', 'redis://localhost:6379'),
        // a slow Redis means "no breaker", never a slow AI call
        { maxRetriesPerRequest: 1, commandTimeout: 500, lazyConnect: true },
      );
      this.redis.on('error', (e: Error) =>
        this.logger.warn(`ai breaker redis: ${e.message}`),
      );
    }
    return this.redis;
  }

  async recordFailure(model: string): Promise<boolean> {
    try {
      const r = this.client();
      const key = `ai:cbf:${model}`;
      const n = await r.incr(key);
      if (n === 1) await r.expire(key, FAILURE_WINDOW_SEC);
      if (n < FAILURE_THRESHOLD) return false;
      const set = await r.set(`ai:cb:${model}`, '1', 'EX', OPEN_SEC, 'NX');
      return set === 'OK';
    } catch {
      return false;
    }
  }

  async isOpen(model: string): Promise<boolean> {
    try {
      return (await this.client().exists(`ai:cb:${model}`)) === 1;
    } catch {
      return false;
    }
  }

  async close() {
    await this.redis?.quit().catch(() => undefined);
  }
}

/** Store + 15 s in-memory cache of open/closed. */
export class CircuitBreaker {
  private cache = new Map<string, { open: boolean; at: number }>();

  constructor(
    private readonly store: CircuitStore,
    private readonly now: () => number = Date.now,
  ) {}

  async isOpen(model: string): Promise<boolean> {
    const hit = this.cache.get(model);
    if (hit && this.now() - hit.at < STATE_CACHE_MS) return hit.open;
    const open = await this.store.isOpen(model);
    this.cache.set(model, { open, at: this.now() });
    return open;
  }

  /** True when this failure opened the circuit. */
  async recordFailure(model: string): Promise<boolean> {
    const opened = await this.store.recordFailure(model);
    if (opened) this.cache.set(model, { open: true, at: this.now() });
    return opened;
  }
}
