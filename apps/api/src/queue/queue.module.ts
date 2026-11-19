import { BullModule } from '@nestjs/bullmq';
import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export const LEAD_IMPORT_QUEUE = 'lead-import';
export const SEGMENT_REFRESH_QUEUE = 'segment-refresh';
export const CAMPAIGN_SEND_QUEUE = 'campaign-send';
/** Scheduled housekeeping: notification emails, weekly summary, Sheets sync. */
export const SYSTEM_JOBS_QUEUE = 'system-jobs';

/**
 * BullMQ infrastructure. One Redis connection shared by every queue; each
 * worker type registers its own queue by name. This is the general job-queue
 * backbone — import now, AI classification / sending / analytics later (E5–E8).
 */
@Global()
@Module({
  imports: [
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        return {
          // Tests use their own key namespace so a dev API running against
          // the same Redis can't pick up (and process) their jobs.
          prefix: process.env.QUEUE_PREFIX || 'bull',
          connection: bullConnection(
            config.get<string>('REDIS_URL', 'redis://localhost:6379'),
          ),
        };
      },
    }),
  ],
  exports: [BullModule],
})
export class QueueModule {}

/**
 * ioredis options from a Redis URL. Keeps the username (Upstash and other
 * managed Redis use ACL users like "default") and turns on TLS for rediss://,
 * which a plain host/port/password split would silently drop.
 */
export function bullConnection(raw: string) {
  const url = new URL(raw);
  const db = Number(url.pathname.replace('/', '') || 0);
  return {
    host: url.hostname,
    port: Number(url.port || 6379),
    username: url.username ? decodeURIComponent(url.username) : undefined,
    password: url.password ? decodeURIComponent(url.password) : undefined,
    ...(db ? { db } : {}),
    ...(url.protocol === 'rediss:'
      ? { tls: { servername: url.hostname } }
      : {}),
  };
}
