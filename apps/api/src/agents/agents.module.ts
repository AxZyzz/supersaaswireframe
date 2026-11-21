import { Module } from '@nestjs/common';
import { AiModule } from '../ai/ai.module';
import { AiChallengerDrafter } from '../review/challenger-drafter';
import { A2aClientService } from './a2a-client.service';
import { AgentChallengerDrafter } from './copywriter-drafter';
import { ReviewExplainerService } from './review-explainer.service';

/**
 * Python ADK agents (apps/agents) reached over A2A: the Review analyst (REVIEW_EXPLAINER) and the
 * Copywriter (COPYWRITER_DRIVER). Both default to the existing non-agent behaviour.
 */
@Module({
  imports: [AiModule],
  providers: [
    A2aClientService,
    ReviewExplainerService,
    AiChallengerDrafter,
    AgentChallengerDrafter,
  ],
  exports: [A2aClientService, ReviewExplainerService, AgentChallengerDrafter],
})
export class AgentsModule {}
