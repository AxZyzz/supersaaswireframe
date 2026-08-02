import { Injectable } from '@nestjs/common';
import { AIGenerateOptions, AIProvider, AIResult } from './ai-provider';

// Rough token estimate — good enough for the mock's usage numbers (real
// providers report exact counts from the API).
const approxTokens = (s: string): number =>
  Math.max(1, Math.ceil(s.length / 4));

// Builds a deterministic value satisfying a (subset of) JSON Schema: first enum
// value, empty-ish by type, recursing into object properties. Keeps the mock
// useful for structured tasks (classification, sequence gen) without an API.
function mockValueFor(schema: Record<string, unknown>): unknown {
  if (Array.isArray(schema.enum) && schema.enum.length > 0) {
    return schema.enum[0];
  }
  switch (schema.type) {
    case 'string':
      return 'mock';
    case 'integer':
    case 'number':
      return 0;
    case 'boolean':
      return false;
    case 'array':
      return [];
    case 'object': {
      const props = (schema.properties ?? {}) as Record<
        string,
        Record<string, unknown>
      >;
      const out: Record<string, unknown> = {};
      for (const [key, sub] of Object.entries(props)) {
        out[key] = mockValueFor(sub);
      }
      return out;
    }
    default:
      return null;
  }
}

// Deterministic AI provider for dev + tests (AI_DRIVER=mock). No network, no
// credentials. Structured requests return schema-valid JSON; free-form requests
// echo a stable, recognizable string.
@Injectable()
export class MockAIProvider implements AIProvider {
  readonly name = 'mock';

  generate(opts: AIGenerateOptions): Promise<AIResult> {
    const text = opts.jsonSchema
      ? JSON.stringify(mockValueFor(opts.jsonSchema))
      : `[mock:${opts.tier ?? 'balanced'}] ${
          opts.messages[opts.messages.length - 1]?.content ?? ''
        }`.trim();

    const promptText =
      (opts.system ?? '') + opts.messages.map((m) => m.content).join(' ');

    return Promise.resolve({
      text,
      usage: {
        inputTokens: approxTokens(promptText),
        outputTokens: approxTokens(text),
      },
      model: 'mock',
      stopReason: 'end_turn',
    });
  }
}
