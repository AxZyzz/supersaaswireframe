import { Module } from '@nestjs/common';
import { AiModule } from '../ai/ai.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { InboxController } from './inbox.controller';
import { InboxService } from './inbox.service';
import { SendersModule } from '../senders/senders.module';

// Unified inbox (E7). Exports InboxService so reply ingestion (E5 chunk 3)
// can hand inbound mail to ingestReply().
@Module({
  imports: [AiModule, NotificationsModule, SendersModule], // classification + new-reply alerts
  controllers: [InboxController],
  providers: [InboxService],
  exports: [InboxService],
})
export class InboxModule {}
