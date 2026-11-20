import { Module } from '@nestjs/common';
import { OutcomesModule } from '../outcomes/outcomes.module';
import { ReviewController } from './review.controller';
import { ReviewDataService } from './review-data.service';
import { ReviewService } from './review.service';

/** Review (Learning Loop T05): policy (T04) + data + the read-only API. */
@Module({
  imports: [OutcomesModule],
  controllers: [ReviewController],
  providers: [ReviewService, ReviewDataService],
  exports: [ReviewService, ReviewDataService],
})
export class ReviewModule {}
