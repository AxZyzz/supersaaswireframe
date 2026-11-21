import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { AnalyticsModule } from '../analytics/analytics.module';
import { IntegrationsModule } from '../integrations/integrations.module';
import { InboxModule } from '../inbox/inbox.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { SYSTEM_JOBS_QUEUE } from '../queue/queue.module';
import { SystemJobsProcessor } from './system-jobs.processor';
import { TickSchedulerService } from './tick-scheduler.service';
import { SendingModule } from '../sending/sending.module';
import { SearchPreferencesModule } from '../search-preferences/search-preferences.module';

@Module({
  imports: [
    BullModule.registerQueue({ name: SYSTEM_JOBS_QUEUE }),
    NotificationsModule,
    AnalyticsModule,
    IntegrationsModule,
    InboxModule,
    SendingModule,
    SearchPreferencesModule,
  ],
  providers: [SystemJobsProcessor, TickSchedulerService],
})
export class JobsModule {}
