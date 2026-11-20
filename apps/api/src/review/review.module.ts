import { Module } from '@nestjs/common';
import { AiModule } from '../ai/ai.module';
import { CampaignsModule } from '../campaigns/campaigns.module';
import { OutcomesModule } from '../outcomes/outcomes.module';
import { AiChallengerDrafter, CHALLENGER_DRAFTER } from './challenger-drafter';
import { ReviewActionsService } from './review-actions.service';
import { ReviewController } from './review.controller';
import { ReviewDataService } from './review-data.service';
import { ReviewService } from './review.service';

/**
 * Review: policy (T04) + data + API (T05) + approvals (T11).
 * The challenger drafter sits behind CHALLENGER_DRAFTER so the ADK Copywriter
 * agent (T09) can replace the Gemini fallback without touching callers.
 */
@Module({
  imports: [OutcomesModule, AiModule, CampaignsModule],
  controllers: [ReviewController],
  providers: [
    ReviewService,
    ReviewDataService,
    ReviewActionsService,
    { provide: CHALLENGER_DRAFTER, useClass: AiChallengerDrafter },
  ],
  exports: [ReviewService, ReviewDataService, ReviewActionsService],
})
export class ReviewModule {}
