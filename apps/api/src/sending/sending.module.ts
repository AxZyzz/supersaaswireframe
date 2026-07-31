import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { CAMPAIGN_SEND_QUEUE } from '../queue/queue.module';
import { SendersModule } from '../senders/senders.module';
import { SendProcessor } from './send.processor';
import { SendService } from './send.service';
import { SendingController } from './sending.controller';

@Module({
  imports: [
    SendersModule, // SendersService.sendMessage
    BullModule.registerQueue({ name: CAMPAIGN_SEND_QUEUE }),
  ],
  controllers: [SendingController],
  providers: [SendService, SendProcessor],
  exports: [SendService],
})
export class SendingModule {}
