import { Module } from '@nestjs/common';
import { AiModule } from '../ai/ai.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { InboxController } from './inbox.controller';
import { InboxService } from './inbox.service';
import { GmailReplySyncService } from './gmail-reply-sync.service';
import { SendersModule } from '../senders/senders.module';
import { OutcomesModule } from '../outcomes/outcomes.module';

// Unified inbox (E7). Exports InboxService so reply ingestion (E5 chunk 3)
// can hand inbound mail to ingestReply().
@Module({
  imports: [AiModule, NotificationsModule, SendersModule, OutcomesModule], // classification + new-reply alerts
  controllers: [InboxController],
  providers: [InboxService, GmailReplySyncService],
  exports: [InboxService, GmailReplySyncService],
})
export class InboxModule {}
