import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { AgentsModule } from '../agents/agents.module';
import { AiModule } from '../ai/ai.module';
import { GoogleCronTokenVerifier } from '../internal/cron-auth.guard';
import { CampaignsModule } from '../campaigns/campaigns.module';
import { LeadsModule } from '../leads/leads.module';
import { PROSPECT_QUEUE } from '../queue/queue.module';
import {
  AGENT_TOOL_TOKEN_VERIFIER,
  AgentToolAuthGuard,
  AgentToolsController,
} from './agent-tools.controller';
import { AgentDiscoverDriver, NativeDiscoverDriver } from './discover-driver';
import { DiscoverRunCache } from './discover-run-cache';
import { ProspectsController } from './prospects.controller';
import { ProspectsProcessor } from './prospects.processor';
import { ProspectsService } from './prospects.service';

@Module({
  imports: [
    BullModule.registerQueue({ name: PROSPECT_QUEUE }),
    AiModule,
    AgentsModule,
    LeadsModule,
    CampaignsModule,
  ],
  controllers: [ProspectsController, AgentToolsController],
  providers: [
    ProspectsService,
    ProspectsProcessor,
    NativeDiscoverDriver,
    AgentDiscoverDriver,
    DiscoverRunCache,
    AgentToolAuthGuard,
    { provide: AGENT_TOOL_TOKEN_VERIFIER, useClass: GoogleCronTokenVerifier },
  ],
})
export class ProspectsModule {}
