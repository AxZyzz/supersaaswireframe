import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AiContentService } from './ai-content.service';
import { AiController } from './ai.controller';
import { AiService } from './ai.service';
import { BedrockAIProvider } from './providers/bedrock.provider';
import { GeminiAIProvider } from './providers/gemini.provider';
import { MockAIProvider } from './providers/mock.provider';
import { AIProviderResolver } from './providers/provider.resolver';
import { ModelRouter } from './router/model-router';
import { ModelArmorSafetyScreen } from './safety/model-armor.screen';
import { NoopSafetyScreen, SAFETY_SCREEN } from './safety/safety-screen';

// AI backbone (E6). AiService is the low-level provider wrapper; AiContentService
// adds the Knowledge Base + campaign generation on top. Exports AiService so
// other feature modules (e.g. reply classification) can generate directly.
@Module({
  controllers: [AiController],
  providers: [
    MockAIProvider,
    BedrockAIProvider,
    GeminiAIProvider,
    AIProviderResolver,
    ModelRouter,
    {
      // SAFETY_DRIVER=modelarmor turns Model Armor on; anything else is a no-op.
      provide: SAFETY_SCREEN,
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        config.get<string>('SAFETY_DRIVER', 'off').toLowerCase() ===
        'modelarmor'
          ? new ModelArmorSafetyScreen(config)
          : new NoopSafetyScreen(),
    },
    AiService,
    AiContentService,
  ],
  exports: [AiService, ModelRouter, SAFETY_SCREEN],
})
export class AiModule {}
