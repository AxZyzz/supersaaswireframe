import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { AppService } from '../app.service';
import {
  CAMPAIGN_SEND_QUEUE,
  LEAD_IMPORT_QUEUE,
  SEGMENT_REFRESH_QUEUE,
} from '../queue/queue.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { OperatorController } from './operator.controller';
import { OperatorGuard } from './operator.guard';
import { OperatorService } from './operator.service';

@Module({
  imports: [
    NotificationsModule,
    BullModule.registerQueue(
      { name: CAMPAIGN_SEND_QUEUE },
      { name: LEAD_IMPORT_QUEUE },
      { name: SEGMENT_REFRESH_QUEUE },
    ),
  ],
  controllers: [OperatorController],
  providers: [OperatorService, OperatorGuard, AppService],
})
export class OperatorModule {}
