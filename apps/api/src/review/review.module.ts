import { Module } from '@nestjs/common';
import { AgentsModule } from '../agents/agents.module';
import { AgentChallengerDrafter } from '../agents/copywriter-drafter';
import { AiModule } from '../ai/ai.module';
import { CampaignsModule } from '../campaigns/campaigns.module';
import { OutcomesModule } from '../outcomes/outcomes.module';
import { PlaybooksModule } from '../playbooks/playbooks.module';
import { CHALLENGER_DRAFTER } from './challenger-drafter';
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
  imports: [
    OutcomesModule,
    AiModule,
    CampaignsModule,
    AgentsModule,
    PlaybooksModule,
  ],
  controllers: [ReviewController],
  providers: [
    ReviewService,
    ReviewDataService,
    ReviewActionsService,
    // T09: the Copywriter agent (COPYWRITER_DRIVER) sits in front of the Gemini drafter
    { provide: CHALLENGER_DRAFTER, useExisting: AgentChallengerDrafter },
  ],
  exports: [ReviewService, ReviewDataService, ReviewActionsService],
})
export class ReviewModule {}
