import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { LEAD_IMPORT_QUEUE } from '../queue/queue.module';
import { ImportController } from './import/import.controller';
import { ImportProcessor } from './import/import.processor';
import { ImportService } from './import/import.service';
import { LeadsController } from './leads.controller';
import { LeadsService } from './leads.service';
import { TagsController } from './tags.controller';
import { TagsService } from './tags.service';

@Module({
  imports: [BullModule.registerQueue({ name: LEAD_IMPORT_QUEUE })],
  controllers: [LeadsController, TagsController, ImportController],
  providers: [LeadsService, TagsService, ImportService, ImportProcessor],
})
export class LeadsModule {}
