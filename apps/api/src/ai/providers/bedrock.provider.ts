import { AnthropicBedrockMantle } from '@anthropic-ai/bedrock-sdk';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  AIGenerateOptions,
  AIModelTier,
  AIProvider,
  AIResult,
} from './ai-provider';

// Claude via AWS Bedrock (Messages-API "Mantle" endpoint). Reached only when
// AI_DRIVER=bedrock; requires AWS_REGION + AWS credentials (IAM: bedrock:
// InvokeModel). Model access must be enabled per-region in the Bedrock console.
// Bedrock model IDs carry an `anthropic.` prefix.
//
// Thinking is intentionally omitted: on Opus 5 / Sonnet 5 omitting it runs
// adaptive thinking by default, while Haiku 4.5 (the 'fast' tier) rejects an
// explicit adaptive config — so leaving it off gives the right behavior per tier.
@Injectable()
export class BedrockAIProvider implements AIProvider {
  readonly name = 'bedrock';
  private client: AnthropicBedrockMantle | null = null;

  constructor(private readonly config: ConfigService) {}

  private tierModel(tier: AIModelTier): string {
    const map: Record<AIModelTier, string> = {
      fast: this.config.get<string>(
        'AI_MODEL_FAST',
        'anthropic.claude-haiku-4-5',
      ),
      balanced: this.config.get<string>(
        'AI_MODEL_BALANCED',
        'anthropic.claude-sonnet-5',
      ),
      powerful: this.config.get<string>(
        'AI_MODEL_POWERFUL',
        'anthropic.claude-opus-5',
      ),
    };
    return map[tier];
  }

  private getClient(): AnthropicBedrockMantle {
    const region = this.config.get<string>('AWS_REGION');
    if (!region) {
      throw new Error(
        'AI not configured: set AWS_REGION and AWS credentials to use the Bedrock provider',
      );
    }
    this.client ??= new AnthropicBedrockMantle({ awsRegion: region });
    return this.client;
  }

  async generate(opts: AIGenerateOptions): Promise<AIResult> {
    const client = this.getClient();
    const res = await client.messages.create({
      model: this.tierModel(opts.tier ?? 'balanced'),
      max_tokens: opts.maxTokens ?? 1024,
      ...(opts.system ? { system: opts.system } : {}),
      messages: opts.messages.map((m) => ({
        role: m.role,
        content: m.content,
      })),
      ...(opts.jsonSchema
        ? {
            output_config: {
              format: { type: 'json_schema', schema: opts.jsonSchema },
            },
          }
        : {}),
    });

    const text = res.content
      .filter(
        (b): b is Extract<typeof b, { type: 'text' }> => b.type === 'text',
      )
      .map((b) => b.text)
      .join('');

    return {
      text,
      usage: {
        inputTokens: res.usage.input_tokens,
        outputTokens: res.usage.output_tokens,
      },
      model: res.model,
      stopReason: res.stop_reason,
    };
  }
}
