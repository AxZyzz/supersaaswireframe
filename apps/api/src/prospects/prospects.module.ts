import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { AiModule } from '../ai/ai.module';
import { LeadsModule } from '../leads/leads.module';
import { PROSPECT_QUEUE } from '../queue/queue.module';
import { ProspectsController } from './prospects.controller';
import { ProspectsProcessor } from './prospects.processor';
import { ProspectsService } from './prospects.service';

@Module({
  imports: [
    BullModule.registerQueue({ name: PROSPECT_QUEUE }),
    AiModule,
    LeadsModule,
  ],
  controllers: [ProspectsController],
  providers: [ProspectsService, ProspectsProcessor],
})
export class ProspectsModule {}
