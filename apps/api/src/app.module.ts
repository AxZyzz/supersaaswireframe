import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AiModule } from './ai/ai.module';
import { AnalyticsModule } from './analytics/analytics.module';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthModule } from './auth/auth.module';
import { BetaModule } from './beta/beta.module';
import { CampaignsModule } from './campaigns/campaigns.module';
import { validateEnv } from './config/env.validation';
import { CryptoModule } from './crypto/crypto.module';
import { DbModule } from './db/db.module';
import { InboxModule } from './inbox/inbox.module';
import { JobsModule } from './jobs/jobs.module';
import { MailModule } from './mail/mail.module';
import { LeadsModule } from './leads/leads.module';
import { NotificationsModule } from './notifications/notifications.module';
import { OperatorModule } from './operator/operator.module';
import { OrgsModule } from './orgs/orgs.module';
import { CAMPAIGN_SEND_QUEUE, QueueModule } from './queue/queue.module';
import { RealtimeModule } from './realtime/realtime.module';
import { SendersModule } from './senders/senders.module';
import { SendingModule } from './sending/sending.module';
import { TemplatesModule } from './templates/templates.module';
import { UsageModule } from './usage/usage.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      // Root .env is the single source; apps/api/.env can override locally.
      envFilePath: ['.env', '../../.env'],
      validate: validateEnv,
    }),
    DbModule,
    CryptoModule,
    MailModule,
    QueueModule,
    UsageModule,
    BetaModule,
    RealtimeModule,
    // readiness probe pings Redis through this queue's connection
    BullModule.registerQueue({ name: CAMPAIGN_SEND_QUEUE }),
    AuthModule,
    OrgsModule,
    LeadsModule,
    SendersModule,
    TemplatesModule,
    CampaignsModule,
    SendingModule,
    AiModule,
    AnalyticsModule,
    JobsModule,
    InboxModule,
    NotificationsModule,
    OperatorModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
