import { Module } from '@nestjs/common';
import { AiService } from './ai.service';
import { BedrockAIProvider } from './providers/bedrock.provider';
import { MockAIProvider } from './providers/mock.provider';
import { AIProviderResolver } from './providers/provider.resolver';

// AI backbone (E6). Exports AiService so feature modules (campaign builder,
// reply classification) can generate without touching providers directly.
@Module({
  providers: [MockAIProvider, BedrockAIProvider, AIProviderResolver, AiService],
  exports: [AiService],
})
export class AiModule {}
