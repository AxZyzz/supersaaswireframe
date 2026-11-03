import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { AnalyticsModule } from '../analytics/analytics.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { SYSTEM_JOBS_QUEUE } from '../queue/queue.module';
import { SystemJobsProcessor } from './system-jobs.processor';

@Module({
  imports: [
    BullModule.registerQueue({ name: SYSTEM_JOBS_QUEUE }),
    NotificationsModule,
    AnalyticsModule,
  ],
  providers: [SystemJobsProcessor],
})
export class JobsModule {}
