import {
  BeforeApplicationShutdown,
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnApplicationShutdown,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';
import Redis from 'ioredis';
import { WeeklySummaryService } from '../analytics/weekly-summary.service';
import { GmailReplySyncService } from '../inbox/gmail-reply-sync.service';
import { SheetsService } from '../integrations/sheets.service';
import { NotificationEmailService } from '../notifications/notification-email.service';
import { SendService } from '../sending/send.service';

interface Tick {
  name: string;
  everyMs: number;
  /** Which switch turns it off: SEND_SCHEDULER or JOBS_SCHEDULER. */
  group: 'send' | 'jobs';
  /** Lock key for this run; default one slot per interval. */
  slot?: () => string | null;
  run: () => Promise<unknown>;
}

/**
 * Runs the repeating work (send loop, notification emails, Gmail reply sync,
 * Sheets sync, Monday summary) from in-process timers instead of BullMQ
 * repeatable jobs.
 *
 * Why: Redis is metered (Upstash bills per command). A queue that holds a
 * repeatable job keeps its worker waking every 10 s (BullMQ's hard cap), and
 * each fire costs ~10 commands. Here each run costs ONE command: a
 * `SET key NX PX` lock, so with several API instances every tick still runs
 * once (whoever takes the lock). Same switches as before: off under tests,
 * SEND_SCHEDULER=off stops the send loop, JOBS_SCHEDULER=off the rest.
 */
@Injectable()
export class TickSchedulerService
  implements
    OnApplicationBootstrap,
    BeforeApplicationShutdown,
    OnApplicationShutdown
{
  private readonly logger = new Logger(TickSchedulerService.name);
  private readonly instance = randomUUID();
  private readonly prefix = `${process.env.QUEUE_PREFIX || 'bull'}:tick`;
  private redis: Redis | null = null;
  private timers: NodeJS.Timeout[] = [];
  private readonly running = new Set<string>();
  /** Promise of each fire() in progress, so shutdown can wait for it. */
  private readonly inflight = new Map<string, Promise<boolean>>();
  /** Set once shutdown starts: no new runs begin after this. */
  private stopping = false;
  /**
   * Longest shutdown waits for in-flight runs. Under Cloud Run's 10 s
   * SIGTERM grace so the pool still closes cleanly before SIGKILL.
   */
  shutdownWaitMs = 8_000;

  constructor(
    private readonly config: ConfigService,
    private readonly send: SendService,
    private readonly notificationEmails: NotificationEmailService,
    private readonly weekly: WeeklySummaryService,
    private readonly sheets: SheetsService,
    private readonly gmailReplies: GmailReplySyncService,
  ) {}

  private enabled(group: Tick['group']): boolean {
    if (process.env.NODE_ENV === 'test') return false;
    const sw = group === 'send' ? 'SEND_SCHEDULER' : 'JOBS_SCHEDULER';
    return process.env[sw] !== 'off';
  }

  /** The schedule. Monday summary: checked every 15 min, once per ISO week. */
  ticks(): Tick[] {
    return [
      {
        name: 'send',
        everyMs: 30_000,
        group: 'send',
        run: () => this.send.tick(),
      },
      {
        name: 'notification-emails',
        everyMs: 60_000,
        group: 'jobs',
        run: () => this.notificationEmails.flush(),
      },
      {
        name: 'gmail-reply-sync',
        everyMs: 2 * 60_000,
        group: 'jobs',
        run: () => this.gmailReplies.runDue(),
      },
      {
        name: 'sheet-sync',
        everyMs: 15 * 60_000,
        group: 'jobs',
        run: () => this.sheets.runDue(),
      },
      {
        name: 'weekly-summary',
        everyMs: 15 * 60_000,
        group: 'jobs',
        slot: () => weeklySlot(new Date()),
        run: () => this.weekly.run(),
      },
    ];
  }

  onApplicationBootstrap() {
    const active = this.ticks().filter((t) => this.enabled(t.group));
    if (active.length === 0) return;
    this.redis = new Redis(
      this.config.get<string>('REDIS_URL', 'redis://localhost:6379'),
      { maxRetriesPerRequest: 2, lazyConnect: false },
    );
    this.redis.on('error', (e: Error) =>
      this.logger.warn(`tick redis: ${e.message}`),
    );
    for (const t of active) {
      this.timers.push(setInterval(() => void this.fire(t), t.everyMs));
    }
    this.logger.log(
      `timers: ${active.map((t) => `${t.name}/${t.everyMs / 1000}s`).join(', ')}`,
    );
  }

  /**
   * Nest runs every beforeApplicationShutdown before any onApplicationShutdown,
   * so this finishes before DbModule ends the pg pool. Without the wait, a send
   * tick cut off between the provider send and the DB write would leave the
   * lead's lease to expire and the next tick would email the prospect again
   * (same for notification emails). The old BullMQ worker.close() gave us this.
   */
  async beforeApplicationShutdown() {
    this.stopping = true;
    this.clearTimers();
    if (this.inflight.size === 0) return;
    const names = [...this.inflight.keys()].join(', ');
    this.logger.log(`shutdown: waiting for ${names}`);
    let cap: NodeJS.Timeout | undefined;
    const timedOut = await Promise.race([
      Promise.allSettled([...this.inflight.values()]).then(() => false),
      new Promise<boolean>((r) => {
        cap = setTimeout(() => r(true), this.shutdownWaitMs);
      }),
    ]);
    clearTimeout(cap);
    if (timedOut)
      this.logger.warn(
        `shutdown: gave up after ${this.shutdownWaitMs} ms on ${[...this.inflight.keys()].join(', ')}`,
      );
  }

  async onApplicationShutdown() {
    this.clearTimers();
    await this.redis?.quit().catch(() => undefined);
  }

  private clearTimers() {
    this.timers.forEach(clearInterval);
    this.timers = [];
  }

  /** One run if this instance wins the lock for the slot. Never overlaps. */
  async fire(t: Tick): Promise<boolean> {
    if (this.stopping || this.running.has(t.name) || !this.redis) return false;
    // Mark running before the lock call so the whole fire (lock + run) is
    // tracked and shutdown can wait on it.
    this.running.add(t.name);
    const p = this.fireLocked(t, this.redis);
    this.inflight.set(t.name, p);
    try {
      return await p;
    } finally {
      this.running.delete(t.name);
      this.inflight.delete(t.name);
    }
  }

  private async fireLocked(t: Tick, redis: Redis): Promise<boolean> {
    const slot = t.slot ? t.slot() : String(Math.floor(Date.now() / t.everyMs));
    if (slot === null) return false; // not due (e.g. not Monday 08:00)
    const ttl = t.slot ? 2 * 24 * 3600_000 : Math.max(1000, t.everyMs - 1000);
    let won: string | null;
    try {
      won = await redis.set(
        `${this.prefix}:${t.name}:${slot}`,
        this.instance,
        'PX',
        ttl,
        'NX',
      );
    } catch (err) {
      this.logger.warn(
        `${t.name}: lock failed, skipping (${err instanceof Error ? err.message : String(err)})`,
      );
      return false;
    }
    if (won !== 'OK') return false; // another instance has this slot
    // Shutdown began while we waited on the lock: skip the run. Only the
    // weekly slot outlives its interval; free it so the next instance runs it.
    if (this.stopping) {
      if (t.slot)
        await redis
          .del(`${this.prefix}:${t.name}:${slot}`)
          .catch(() => undefined);
      return false;
    }
    try {
      await t.run();
    } catch (err) {
      this.logger.error(
        `${t.name} failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    return true;
  }
}

/** "2026-W47" during Monday 08:00-08:59 UTC, else null (summary not due). */
export function weeklySlot(now: Date): string | null {
  if (now.getUTCDay() !== 1 || now.getUTCHours() !== 8) return null;
  const d = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
  // ISO week number (Thursday rule)
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const yearStart = Date.UTC(d.getUTCFullYear(), 0, 1);
  const week = Math.ceil(((d.getTime() - yearStart) / 86400000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}
