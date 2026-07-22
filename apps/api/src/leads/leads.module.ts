import { Module } from '@nestjs/common';
import { LeadsController } from './leads.controller';
import { LeadsService } from './leads.service';
import { TagsController } from './tags.controller';
import { TagsService } from './tags.service';

@Module({
  controllers: [LeadsController, TagsController],
  providers: [LeadsService, TagsService],
})
export class LeadsModule {}
