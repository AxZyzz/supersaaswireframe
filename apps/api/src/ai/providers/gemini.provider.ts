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

// When the chosen model answers 503 "high demand" (common on the free tier),
// one retry on a lighter model usually succeeds. Override or disable ('off')
// with GEMINI_FALLBACK_MODEL.
const OVERLOADED =
  /\b50[34]\b|UNAVAILABLE|DEADLINE_EXCEEDED|high demand|overloaded|timed out/i;

// The SDK sets no client-side timeout (Google's server may hold a request
// for up to 10 minutes) and retries 503/429 itself up to 5 times with delays
// up to 60s. Left alone, one overloaded call hung the reply composer for
// minutes. We cap each attempt and let AiService own the retries instead.
const DEFAULT_TIMEOUT_MS = 45_000;

// Gemini 2.5+/3.x Flash and Pro models "think" before answering, and those thought tokens count
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
 * _POWERFUL) because Google renames and retires models often. Defaults were
 * live-checked on 2026-11-18 with a new AI Studio key: 2.5 models are closed
 * to new users, and Pro models have no free-tier quota. Drafts and edits
 * ('balanced') use Flash-Lite since 2026-11-19: gemini-3.8-flash was so often
 * "high demand" that drafts sat on the 45s timeout before falling back. The
 * campaign builder ('powerful') keeps gemini-3.8-flash (falls back to
 * Flash-Lite when busy); with billing on, GEMINI_MODEL_POWERFUL=gemini-pro-latest.
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
        'gemini-3.5-flash-lite',
      ),
      balanced: this.config.get<string>(
        'GEMINI_MODEL_BALANCED',
        'gemini-3.5-flash-lite',
      ),
      powerful: this.config.get<string>(
        'GEMINI_MODEL_POWERFUL',
        'gemini-3.8-flash',
      ),
    };
    return map[tier];
  }

  private timeoutMs(): number {
    const v = Number(this.config.get<string>('GEMINI_TIMEOUT_MS'));
    return Number.isFinite(v) && v > 0 ? v : DEFAULT_TIMEOUT_MS;
  }

  private client(): GenerateFn {
    if (this.generateFn) return this.generateFn;
    const httpOptions = {
      timeout: this.timeoutMs(),
      retryOptions: { attempts: 1 }, // AiService retries, not the SDK
    };
    let ai: GoogleGenAI;
    if (this.config.get<string>('GEMINI_USE_VERTEX') === 'true') {
      const project = this.config.get<string>('GOOGLE_CLOUD_PROJECT');
      if (!project) {
        throw new Error(
          'AI not configured: set GOOGLE_CLOUD_PROJECT to use Gemini on Vertex AI',
        );
      }
      ai = new GoogleGenAI({
        httpOptions,
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
      ai = new GoogleGenAI({ apiKey, httpOptions });
    }
    this.generateFn = (p) => ai.models.generateContent(p);
    return this.generateFn;
  }

  async generate(opts: AIGenerateOptions): Promise<AIResult> {
    const model = this.tierModel(opts.tier ?? 'balanced');
    const fallback = this.config.get<string>(
      'GEMINI_FALLBACK_MODEL',
      'gemini-3.5-flash-lite',
    );
    try {
      return await this.generateWith(model, opts);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (fallback === 'off' || fallback === model || !OVERLOADED.test(msg)) {
        throw err;
      }
      return this.generateWith(fallback, opts);
    }
  }

  private async generateWith(
    model: string,
    opts: AIGenerateOptions,
  ): Promise<AIResult> {
    let res: GenerateContentResponse;
    try {
      res = await this.callModel(model, opts);
    } catch (err) {
      // The SDK's abort timer surfaces as AbortError / RequestAbortedError;
      // give it a readable message that AiService treats as retryable.
      const name = (err as { name?: string })?.name;
      if (name === 'AbortError' || name === 'RequestAbortedError') {
        throw new Error(
          `Gemini timed out after ${Math.round(this.timeoutMs() / 1000)}s (${model})`,
        );
      }
      throw err;
    }
    return this.toResult(model, res);
  }

  private callModel(model: string, opts: AIGenerateOptions) {
    return this.client()({
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
  }

  private toResult(model: string, res: GenerateContentResponse): AIResult {
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
