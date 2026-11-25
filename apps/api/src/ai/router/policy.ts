import type { ConfigService } from '@nestjs/config';
import type { AIModelTier } from '../providers/ai-provider';

// Tier → ordered model list for the active provider. Env overrides are the
// same ones the Gemini adapter always had (GEMINI_MODEL_*, GEMINI_FALLBACK_MODEL).
// An empty list means "the provider picks its own model" (Bedrock, mock).
const GEMINI_DEFAULT = 'gemini-3.5-flash-lite';

export const TIER_ORDER: AIModelTier[] = ['fast', 'balanced', 'powerful'];

/** One tier cheaper (powerful → balanced → fast); fast stays fast. */
export function downgradeTier(tier: AIModelTier): AIModelTier {
  const i = TIER_ORDER.indexOf(tier);
  return TIER_ORDER[Math.max(0, i - 1)];
}

export function modelsForTier(
  driver: string,
  tier: AIModelTier,
  config: ConfigService,
): string[] {
  if (driver !== 'gemini') return [];
  const env = {
    fast: 'GEMINI_MODEL_FAST',
    balanced: 'GEMINI_MODEL_BALANCED',
    powerful: 'GEMINI_MODEL_POWERFUL',
  }[tier];
  // a blank value in .env means "use the default", same as unset
  const get = (k: string) => config.get<string>(k)?.trim() || GEMINI_DEFAULT;
  const primary = get(env);
  const fallback = get('GEMINI_FALLBACK_MODEL');
  const list = [primary];
  if (fallback && fallback !== 'off' && fallback !== primary) {
    list.push(fallback);
  }
  return list;
}
