import {
  GenerateContentParameters,
  GenerateContentResponse,
  GoogleGenAI,
} from '@google/genai';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  AIGenerateOptions,
  AIModelTier,
  AIProvider,
  AIResult,
} from './ai-provider';

type GenerateFn = (
  params: GenerateContentParameters,
) => Promise<GenerateContentResponse>;

// Gemini 2.5+ models "think" before answering, and those thought tokens count
// against maxOutputTokens. Without headroom a structured (JSON) answer can be
// cut off mid-object. Billing is per token actually used, so a higher cap
// costs nothing unless the model needs it.
const THINKING_HEADROOM = 8192;

/**
 * Gemini via Google's GenAI SDK (`@google/genai`) — the google-stack branch's
 * alternative to Claude-on-Bedrock. Reached only when AI_DRIVER=gemini.
 *
 * Two ways in, same SDK:
 * - Gemini API (default): GEMINI_API_KEY from Google AI Studio.
 * - Vertex AI: GEMINI_USE_VERTEX=true + GOOGLE_CLOUD_PROJECT (+ optional
 *   GOOGLE_CLOUD_LOCATION), authenticated by Google Cloud application
 *   default credentials instead of a key.
 *
 * Model per tier is env-overridable (GEMINI_MODEL_FAST / _BALANCED /
 * _POWERFUL) because Google renames and retires models often.
 */
@Injectable()
export class GeminiAIProvider implements AIProvider {
  readonly name = 'gemini';
  private generateFn: GenerateFn | null = null;

  constructor(private readonly config: ConfigService) {}

  /** Test seam: replace the network call with a stub. */
  useGenerateFn(fn: GenerateFn) {
    this.generateFn = fn;
  }

  private tierModel(tier: AIModelTier): string {
    const map: Record<AIModelTier, string> = {
      fast: this.config.get<string>(
        'GEMINI_MODEL_FAST',
        'gemini-2.5-flash-lite',
      ),
      balanced: this.config.get<string>(
        'GEMINI_MODEL_BALANCED',
        'gemini-2.5-flash',
      ),
      powerful: this.config.get<string>(
        'GEMINI_MODEL_POWERFUL',
        'gemini-2.5-pro',
      ),
    };
    return map[tier];
  }

  private client(): GenerateFn {
    if (this.generateFn) return this.generateFn;
    let ai: GoogleGenAI;
    if (this.config.get<string>('GEMINI_USE_VERTEX') === 'true') {
      const project = this.config.get<string>('GOOGLE_CLOUD_PROJECT');
      if (!project) {
        throw new Error(
          'AI not configured: set GOOGLE_CLOUD_PROJECT to use Gemini on Vertex AI',
        );
      }
      ai = new GoogleGenAI({
        vertexai: true,
        project,
        location: this.config.get<string>(
          'GOOGLE_CLOUD_LOCATION',
          'us-central1',
        ),
      });
    } else {
      const apiKey = this.config.get<string>('GEMINI_API_KEY');
      if (!apiKey) {
        throw new Error(
          'AI not configured: set GEMINI_API_KEY (Google AI Studio) to use the Gemini provider',
        );
      }
      ai = new GoogleGenAI({ apiKey });
    }
    this.generateFn = (p) => ai.models.generateContent(p);
    return this.generateFn;
  }

  async generate(opts: AIGenerateOptions): Promise<AIResult> {
    const model = this.tierModel(opts.tier ?? 'balanced');
    const res = await this.client()({
      model,
      // Gemini calls the assistant role "model".
      contents: opts.messages.map((m) => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.content }],
      })),
      config: {
        ...(opts.system ? { systemInstruction: opts.system } : {}),
        maxOutputTokens: (opts.maxTokens ?? 1024) + THINKING_HEADROOM,
        ...(opts.jsonSchema
          ? {
              responseMimeType: 'application/json',
              responseJsonSchema: opts.jsonSchema,
            }
          : {}),
      },
    });

    const finish = res.candidates?.[0]?.finishReason ?? null;
    const text = res.text ?? '';
    if (!text) {
      // e.g. a safety block or the token cap: surface why instead of
      // handing callers an empty string to parse.
      throw new Error(
        `Gemini returned no text (finish reason: ${finish ?? 'unknown'})`,
      );
    }
    const u = res.usageMetadata;
    return {
      text,
      usage: {
        inputTokens: u?.promptTokenCount ?? 0,
        // thought tokens are billed as output
        outputTokens:
          (u?.candidatesTokenCount ?? 0) + (u?.thoughtsTokenCount ?? 0),
      },
      model: res.modelVersion ?? model,
      stopReason: finish ? String(finish) : null,
    };
  }
}
