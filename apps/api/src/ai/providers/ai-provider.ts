// Provider seam for the AI layer — mirrors the E3 EmailProvider pattern so the
// rest of E6 targets this interface, not a concrete SDK. Real inference runs
// through Bedrock (creds-gated); MockAIProvider gives deterministic output for
// dev + tests (AI_DRIVER=mock).

// Capability tiers, mapped to concrete model IDs by the provider. Callers pick a
// tier by task cost/quality — classification is 'fast', drafting 'balanced',
// the campaign builder 'powerful' — without hard-coding model strings.
export type AIModelTier = 'fast' | 'balanced' | 'powerful';

export interface AIMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface AIGenerateOptions {
  system?: string;
  messages: AIMessage[];
  tier?: AIModelTier; // default 'balanced'
  maxTokens?: number; // default 1024
  // When set, the provider constrains output to this JSON Schema (structured
  // output) and `text` is a JSON string matching it.
  jsonSchema?: Record<string, unknown>;
  // Which prompt template + revision produced this request (logged to
  // ai_usage so output quality can be traced to a prompt change).
  promptVersion?: string;
}

export interface AIUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface AIResult {
  text: string;
  usage: AIUsage;
  model: string;
  stopReason: string | null;
}

export interface AIProvider {
  readonly name: string;
  generate(opts: AIGenerateOptions): Promise<AIResult>;
}

// DI token so consumers inject the resolved provider by interface.
export const AI_PROVIDER = Symbol('AI_PROVIDER');
