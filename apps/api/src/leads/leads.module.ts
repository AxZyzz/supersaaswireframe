import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import {
  LEAD_IMPORT_QUEUE,
  SEGMENT_REFRESH_QUEUE,
} from '../queue/queue.module';
import { ImportController } from './import/import.controller';
import { ImportProcessor } from './import/import.processor';
import { ImportService } from './import/import.service';
import { LeadsController } from './leads.controller';
import { LeadsService } from './leads.service';
import { SegmentRefreshProcessor } from './segments/segment-refresh.processor';
import { SegmentsController } from './segments/segments.controller';
import { SegmentsService } from './segments/segments.service';
import { TagsController } from './tags.controller';
import { TagsService } from './tags.service';

@Module({
  imports: [
    BullModule.registerQueue(
      { name: LEAD_IMPORT_QUEUE },
      { name: SEGMENT_REFRESH_QUEUE },
    ),
  ],
  controllers: [
    LeadsController,
    TagsController,
    ImportController,
    SegmentsController,
  ],
  providers: [
    LeadsService,
    TagsService,
    ImportService,
    ImportProcessor,
    SegmentsService,
    SegmentRefreshProcessor,
  ],
})
export class LeadsModule {}
