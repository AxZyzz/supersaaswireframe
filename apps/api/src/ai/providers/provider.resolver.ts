import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AIProvider } from './ai-provider';
import { BedrockAIProvider } from './bedrock.provider';
import { MockAIProvider } from './mock.provider';

// Dispatches to the active AI provider by AI_DRIVER (default 'mock', matching
// the E3 EMAIL_DRIVER pattern). 'bedrock' selects real Claude-on-Bedrock.
@Injectable()
export class AIProviderResolver {
  private readonly logger = new Logger(AIProviderResolver.name);

  constructor(
    private readonly config: ConfigService,
    private readonly mock: MockAIProvider,
    private readonly bedrock: BedrockAIProvider,
  ) {}

  resolve(): AIProvider {
    const driver = this.config.get<string>('AI_DRIVER', 'mock').toLowerCase();
    switch (driver) {
      case 'bedrock':
        return this.bedrock;
      case 'mock':
        return this.mock;
      default:
        this.logger.warn(
          `Unknown AI_DRIVER "${driver}" — falling back to mock`,
        );
        return this.mock;
    }
  }
}
