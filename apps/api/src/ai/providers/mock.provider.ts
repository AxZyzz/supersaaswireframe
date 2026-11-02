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

// The generic schema walk yields `steps: []`, which leaves the AI builder
// empty in dev/demo. For sequence requests, return a realistic, deterministic
// draft of the requested length (read from the "Produce exactly N" line).
const MOCK_STEPS = [
  {
    subject: 'Quick idea for {company|your team}',
    body: 'Hi {first_name|there},\n\nNoticed what {company|your team} is working on and had one idea that could help. Worth a quick chat this week?\n\n{sender_name}',
  },
  {
    subject: 'Following up',
    body: 'Hi {first_name|there},\n\nJust bumping this in case it got buried. Happy to share a two-minute summary if useful.\n\n{sender_name}',
  },
  {
    subject: 'Closing the loop',
    body: "Hi {first_name|there},\n\nI'll leave it here for now. If timing is better later, just reply and I'll pick it back up.\n\n{sender_name}",
  },
];

function mockSequence(opts: AIGenerateOptions) {
  const props = (opts.jsonSchema?.properties ?? {}) as Record<string, unknown>;
  if (!props.steps) return null;
  const prompt = opts.messages.map((m) => m.content).join('\n');
  const asked = Number(/exactly (\d+)/.exec(prompt)?.[1] ?? 3);
  const n = Math.min(8, Math.max(1, asked));
  return {
    steps: Array.from({ length: n }, (_, i) => ({
      ...MOCK_STEPS[Math.min(i, MOCK_STEPS.length - 1)],
      delayHours: i === 0 ? 0 : 72 * i,
    })),
  };
}

// Deterministic AI provider for dev + tests (AI_DRIVER=mock). No network, no
// credentials. Structured requests return schema-valid JSON; free-form requests
// echo a stable, recognizable string.
@Injectable()
export class MockAIProvider implements AIProvider {
  readonly name = 'mock';

  generate(opts: AIGenerateOptions): Promise<AIResult> {
    const sequence = mockSequence(opts);
    const text = sequence
      ? JSON.stringify(sequence)
      : opts.jsonSchema
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
