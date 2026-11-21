import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';
import Redis from 'ioredis';
import { TickSchedulerService, weeklySlot } from './tick-scheduler.service';

/** Needs the local Redis (docker compose), like the queue tests. */
describe('TickSchedulerService', () => {
  const url = process.env.REDIS_URL || 'redis://127.0.0.1:6379';
  let redis: Redis;

  const make = () => {
    const svc = new TickSchedulerService(
      new ConfigService({ REDIS_URL: url }),
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
    (svc as unknown as { redis: Redis }).redis = redis;
    return svc;
  };

  beforeAll(() => {
    redis = new Redis(url, { maxRetriesPerRequest: 1 });
  });
  afterAll(async () => {
    await redis.quit();
  });

  it('with two API instances, each tick runs once (one SET NX per run)', async () => {
    let runs = 0;
    const tick = {
      name: `spec-${randomUUID()}`,
      everyMs: 60_000,
      group: 'jobs' as const,
      run: () => {
        runs++;
        return Promise.resolve();
      },
    };
    const [a, b] = [make(), make()];
    const results = await Promise.all([a.fire(tick), b.fire(tick)]);
    expect(results.filter(Boolean)).toHaveLength(1);
    expect(runs).toBe(1);
  });

  it('never overlaps a slow run on the same instance', async () => {
    let release!: () => void;
    let runs = 0;
    const svc = make();
    const tick = {
      name: `slow-${randomUUID()}`,
      everyMs: 1000,
      group: 'jobs' as const,
      // fresh slot per call so only the in-process guard can block it
      slot: () => randomUUID(),
      run: () => {
        runs++;
        return new Promise<void>((r) => (release = r));
      },
    };
    const first = svc.fire(tick);
    await new Promise((r) => setTimeout(r, 50));
    expect(await svc.fire(tick)).toBe(false);
    release();
    expect(await first).toBe(true);
    expect(runs).toBe(1);
  });

  it('a failing run is logged, not thrown', async () => {
    const svc = make();
    const ok = await svc.fire({
      name: `fail-${randomUUID()}`,
      everyMs: 60_000,
      group: 'jobs',
      run: () => Promise.reject(new Error('boom')),
    });
    expect(ok).toBe(true);
  });

  it('shutdown waits for an in-flight run before the pool closes', async () => {
    let release!: () => void;
    let finished = false;
    const svc = make();
    const tick = {
      name: `inflight-${randomUUID()}`,
      everyMs: 60_000,
      group: 'send' as const,
      slot: () => randomUUID(),
      run: () =>
        new Promise<void>((r) => (release = r)).then(() => {
          finished = true; // e.g. SendService Phase 3 write
        }),
    };
    const first = svc.fire(tick);
    await new Promise((r) => setTimeout(r, 50));
    let shutDown = false;
    const stop = svc.beforeApplicationShutdown().then(() => (shutDown = true));
    await new Promise((r) => setTimeout(r, 100));
    expect(shutDown).toBe(false); // still waiting on the run
    release();
    await stop;
    expect(finished).toBe(true);
    expect(await first).toBe(true);
  });

  it('no new run starts once shutdown has begun', async () => {
    let runs = 0;
    const svc = make();
    await svc.beforeApplicationShutdown();
    const ok = await svc.fire({
      name: `late-${randomUUID()}`,
      everyMs: 60_000,
      group: 'jobs',
      slot: () => randomUUID(),
      run: () => {
        runs++;
        return Promise.resolve();
      },
    });
    expect(ok).toBe(false);
    expect(runs).toBe(0);
  });

  it('shutdown during the lock call skips the run and frees a weekly slot', async () => {
    let runs = 0;
    const svc = make();
    const name = `midlock-${randomUUID()}`;
    const slot = randomUUID();
    // fire() is now awaiting SET NX; shutdown starts before the reply lands.
    const p = svc.fire({
      name,
      everyMs: 60_000,
      group: 'jobs',
      slot: () => slot,
      run: () => {
        runs++;
        return Promise.resolve();
      },
    });
    await svc.beforeApplicationShutdown();
    expect(await p).toBe(false);
    expect(runs).toBe(0);
    // the 2-day weekly lock is released so another instance can run it
    const prefix = `${process.env.QUEUE_PREFIX || 'bull'}:tick`;
    expect(await redis.exists(`${prefix}:${name}:${slot}`)).toBe(0);
  });

  it('shutdown wait is capped so a stuck run cannot block exit', async () => {
    const svc = make();
    svc.shutdownWaitMs = 100;
    void svc.fire({
      name: `stuck-${randomUUID()}`,
      everyMs: 60_000,
      group: 'jobs',
      slot: () => randomUUID(),
      run: () => new Promise<void>(() => undefined),
    });
    await new Promise((r) => setTimeout(r, 50));
    const t0 = Date.now();
    await svc.beforeApplicationShutdown();
    expect(Date.now() - t0).toBeLessThan(2000);
  });

  it('weekly summary slot: Monday 08:xx UTC only, one per ISO week', () => {
    expect(weeklySlot(new Date('2026-11-23T08:05:00Z'))).toBe('2026-W48');
    expect(weeklySlot(new Date('2026-11-23T08:59:00Z'))).toBe('2026-W48');
    expect(weeklySlot(new Date('2026-11-23T09:00:00Z'))).toBeNull();
    expect(weeklySlot(new Date('2026-11-24T08:05:00Z'))).toBeNull();
    expect(weeklySlot(new Date('2027-01-04T08:00:00Z'))).toBe('2027-W01');
  });

  it('schedule keeps the old cadence', () => {
    const t = make().ticks();
    expect(
      Object.fromEntries(t.map((x) => [x.name, x.everyMs / 1000])),
    ).toEqual({
      send: 30,
      'notification-emails': 60,
      'gmail-reply-sync': 120,
      'sheet-sync': 900,
      'weekly-summary': 900,
    });
  });
});
