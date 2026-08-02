import { Module } from '@nestjs/common';
import { AiContentService } from './ai-content.service';
import { AiController } from './ai.controller';
import { AiService } from './ai.service';
import { BedrockAIProvider } from './providers/bedrock.provider';
import { MockAIProvider } from './providers/mock.provider';
import { AIProviderResolver } from './providers/provider.resolver';

// AI backbone (E6). AiService is the low-level provider wrapper; AiContentService
// adds the Knowledge Base + campaign generation on top. Exports AiService so
// other feature modules (e.g. reply classification) can generate directly.
@Module({
  controllers: [AiController],
  providers: [
    MockAIProvider,
    BedrockAIProvider,
    AIProviderResolver,
    AiService,
    AiContentService,
  ],
  exports: [AiService],
})
export class AiModule {}
