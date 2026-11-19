import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { AnalyticsModule } from '../analytics/analytics.module';
import { IntegrationsModule } from '../integrations/integrations.module';
import { InboxModule } from '../inbox/inbox.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { SYSTEM_JOBS_QUEUE } from '../queue/queue.module';
import { SystemJobsProcessor } from './system-jobs.processor';

@Module({
  imports: [
    BullModule.registerQueue({ name: SYSTEM_JOBS_QUEUE }),
    NotificationsModule,
    AnalyticsModule,
    IntegrationsModule,
    InboxModule,
  ],
  providers: [SystemJobsProcessor],
})
export class JobsModule {}
