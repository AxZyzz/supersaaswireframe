// Per-org daily AI token budget. Used tokens come from ai_usage (today),
// cached 60 s per org so a busy org costs one query a minute, not one per call.
export const BUDGET_CACHE_MS = 60_000;
export const DEFAULT_DAILY_TOKEN_CAP = 2_000_000;

/** ok = under the cap · over = past the cap (downgrade) · hard = past 2× the cap. */
export type BudgetLevel = 'ok' | 'over' | 'hard';

export class AiBudget {
  private cache = new Map<string, { tokens: number; at: number }>();

  constructor(
    private readonly loadTokensToday: (orgId: string) => Promise<number>,
    private readonly cap: () => number,
    private readonly now: () => number = Date.now,
  ) {}

  async level(orgId: string): Promise<BudgetLevel> {
    const cap = this.cap();
    if (!(cap > 0)) return 'ok'; // 0 / unset = no cap
    let used: number;
    try {
      used = await this.tokens(orgId);
    } catch {
      return 'ok'; // a usage-table hiccup never blocks AI
    }
    if (used >= cap * 2) return 'hard';
    if (used >= cap) return 'over';
    return 'ok';
  }

  private async tokens(orgId: string): Promise<number> {
    const hit = this.cache.get(orgId);
    if (hit && this.now() - hit.at < BUDGET_CACHE_MS) return hit.tokens;
    const tokens = await this.loadTokensToday(orgId);
    this.cache.set(orgId, { tokens, at: this.now() });
    return tokens;
  }
}
