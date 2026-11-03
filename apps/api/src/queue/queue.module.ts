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
        const url = new URL(
          config.get<string>('REDIS_URL', 'redis://localhost:6379'),
        );
        return {
          connection: {
            host: url.hostname,
            port: Number(url.port || 6379),
            password: url.password || undefined,
          },
        };
      },
    }),
  ],
  exports: [BullModule],
})
export class QueueModule {}
