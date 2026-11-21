import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import {
  LEAD_IMPORT_QUEUE,
  MAIL_PROVIDER_QUEUE,
  SEGMENT_REFRESH_QUEUE,
} from '../queue/queue.module';
import { ApiKeyGuard } from './api/api-key.guard';
import { ApiKeysController } from './api/api-keys.controller';
import { ApiKeysService } from './api/api-keys.service';
import { PublicLeadsController } from './api/public-leads.controller';
import { ImportController } from './import/import.controller';
import { ImportProcessor } from './import/import.processor';
import { ImportService } from './import/import.service';
import { LeadsController } from './leads.controller';
import { LeadsService } from './leads.service';
import {
  MailProviderProcessor,
  MailProviderService,
} from './mail-provider.service';
import { SegmentRefreshProcessor } from './segments/segment-refresh.processor';
import { SegmentsController } from './segments/segments.controller';
import { SegmentsService } from './segments/segments.service';
import { TagsController } from './tags.controller';
import { TagsService } from './tags.service';
import { ThrottlerStorageModule } from '../auth/redis-throttler.storage';
import { LeadStatusesController, LeadStatusesService } from './lead-statuses';
import { AiModule } from '../ai/ai.module';

@Module({
  imports: [
    ThrottlerStorageModule,
    AiModule,
    BullModule.registerQueue(
      { name: LEAD_IMPORT_QUEUE },
      { name: SEGMENT_REFRESH_QUEUE },
      { name: MAIL_PROVIDER_QUEUE },
    ),
  ],
  controllers: [
    LeadsController,
    TagsController,
    ImportController,
    SegmentsController,
    ApiKeysController,
    PublicLeadsController,
    LeadStatusesController,
  ],
  providers: [
    LeadsService,
    TagsService,
    ImportService,
    ImportProcessor,
    SegmentsService,
    SegmentRefreshProcessor,
    ApiKeysService,
    ApiKeyGuard,
    LeadStatusesService,
    MailProviderService,
    MailProviderProcessor,
  ],
  // Sheets sync (T2.8) feeds rows through the same import pipeline.
  exports: [ImportService, LeadsService, SegmentsService, MailProviderService],
})
export class LeadsModule {}
