import { Module } from '@nestjs/common';
import { AiModule } from '../ai/ai.module';
import { InboxController } from './inbox.controller';
import { InboxService } from './inbox.service';

// Unified inbox (E7). Exports InboxService so reply ingestion (E5 chunk 3)
// can hand inbound mail to ingestReply().
@Module({
  imports: [AiModule], // AiService for reply classification
  controllers: [InboxController],
  providers: [InboxService],
  exports: [InboxService],
})
export class InboxModule {}
