import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AiModule } from './ai/ai.module';
import { AnalyticsModule } from './analytics/analytics.module';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthModule } from './auth/auth.module';
import { CampaignsModule } from './campaigns/campaigns.module';
import { CryptoModule } from './crypto/crypto.module';
import { DbModule } from './db/db.module';
import { InboxModule } from './inbox/inbox.module';
import { LeadsModule } from './leads/leads.module';
import { OrgsModule } from './orgs/orgs.module';
import { QueueModule } from './queue/queue.module';
import { SendersModule } from './senders/senders.module';
import { SendingModule } from './sending/sending.module';
import { TemplatesModule } from './templates/templates.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      // Root .env is the single source; apps/api/.env can override locally.
      envFilePath: ['.env', '../../.env'],
    }),
    DbModule,
    CryptoModule,
    QueueModule,
    AuthModule,
    OrgsModule,
    LeadsModule,
    SendersModule,
    TemplatesModule,
    CampaignsModule,
    SendingModule,
    AiModule,
    AnalyticsModule,
    InboxModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
