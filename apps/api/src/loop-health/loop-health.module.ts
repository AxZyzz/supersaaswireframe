import { Module } from '@nestjs/common';
import { OutcomesModule } from '../outcomes/outcomes.module';
import { LoopHealthController } from './loop-health.controller';
import { LoopHealthService } from './loop-health.service';
import { ReviewDigestService } from './review-digest.service';

/** Loop health + the Review lines of the weekly summary (Learning Loop T13). */
@Module({
  imports: [OutcomesModule],
  controllers: [LoopHealthController],
  providers: [LoopHealthService, ReviewDigestService],
  exports: [LoopHealthService, ReviewDigestService],
})
export class LoopHealthModule {}
