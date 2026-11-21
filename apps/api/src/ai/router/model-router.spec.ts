import { HttpException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Pool } from 'pg';
import type { AIGenerateOptions, AIProvider } from '../providers/ai-provider';
import { AiService } from '../ai.service';
import { AiBudget } from './budget';
import { MemoryCircuitStore } from './circuit-breaker';
import { ModelRouter } from './model-router';
import { downgradeTier, modelsForTier } from './policy';
import { AI_TASKS, FEATURE_TASK, TASK_CATALOGUE } from './tasks';

const MODELS = {
  GEMINI_MODEL_FAST: 'fast-a',
  GEMINI_MODEL_BALANCED: 'bal-a',
  GEMINI_MODEL_POWERFUL: 'pow-a',
  GEMINI_FALLBACK_MODEL: 'fallback-b',
};

const config = (env: Record<string, string> = {}) =>
  ({
    get: (k: string, d?: string) => ({ ...MODELS, ...env })[k] ?? d,
  }) as unknown as ConfigService;

/** A fake "gemini" provider: `failing` models answer 503, others succeed. */
function fakeProvider(failing: Set<string>) {
  const calls: { model?: string; tier?: string }[] = [];
  const provider: AIProvider = {
    name: 'gemini',
    generate: (o: AIGenerateOptions) => {
      calls.push({ model: o.model, tier: o.tier });
      if (o.model && failing.has(o.model)) {
        return Promise.reject(new Error('503 UNAVAILABLE: high demand'));
      }
      return Promise.resolve({
        text: 'ok',
        usage: { inputTokens: 10, outputTokens: 5 },
        model: o.model ?? 'x',
        stopReason: 'end_turn',
      });
    },
  };
  return { provider, calls };
}

function makeRouter(env: Record<string, string> = {}) {
  const router = new ModelRouter(config(env), {} as Pool);
  router.backoffBaseMs = 0;
  router.useCircuitStore(new MemoryCircuitStore());
  const lines: Record<string, unknown>[] = [];
  router.log.setSink((l) =>
    lines.push(JSON.parse(l) as Record<string, unknown>),
  );
  return { router, lines };
}
const opts: AIGenerateOptions = { messages: [{ role: 'user', content: 'hi' }] };

describe('Task catalogue', () => {
  it('has the nine tasks from the spec with the spec tiers', () => {
    expect(AI_TASKS).toHaveLength(9);
    expect(TASK_CATALOGUE.reply_classify.tier).toBe('fast');
    expect(TASK_CATALOGUE.campaign_build.tier).toBe('powerful');
    expect(TASK_CATALOGUE.challenger_draft.tier).toBe('powerful');
    expect(TASK_CATALOGUE.reply_draft.tier).toBe('balanced');
    for (const t of AI_TASKS) {
      expect(TASK_CATALOGUE[t].timeoutMs).toBeGreaterThan(0);
      expect(TASK_CATALOGUE[t].maxOutputTokens).toBeGreaterThan(0);
    }
  });

  it('every legacy ai_usage feature maps to a task', () => {
    for (const task of Object.values(FEATURE_TASK)) {
      expect(AI_TASKS).toContain(task);
    }
    expect(FEATURE_TASK['sequence-gen']).toBe('campaign_build');
  });
});

describe('ModelRouter', () => {
  it('uses the tier policy model and logs why (reason=policy)', async () => {
    const { router, lines } = makeRouter();
    const { provider, calls } = fakeProvider(new Set());
    await router.execute('org', 'campaign_build', opts, provider);
    expect(calls[0]).toMatchObject({ model: 'pow-a', tier: 'powerful' });
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({
      event: 'ai_route',
      task: 'campaign_build',
      chosen_model: 'pow-a',
      reason: 'policy',
      attempt: 1,
      tokens: 15,
    });
    expect(typeof lines[0].latency_ms).toBe('number');
  });

  it('simulated 503s: circuit opens, fallback model answers, later calls skip the sick model', async () => {
    const { router, lines } = makeRouter();
    const { provider, calls } = fakeProvider(new Set(['pow-a']));

    // call 1: pow-a fails, fallback-b answers
    await router.execute('org', 'campaign_build', opts, provider);
    expect(calls.map((c) => c.model)).toEqual(['pow-a', 'fallback-b']);
    const ok1 = lines.filter((l) => l.event === 'ai_route' && !l.error);
    expect(ok1[0]).toMatchObject({
      chosen_model: 'fallback-b',
      reason: 'fallback_timeout',
      attempt: 2,
    });

    // two more failures on pow-a (3 in total) open the circuit
    await router.execute('org', 'campaign_build', opts, provider);
    await router.execute('org', 'campaign_build', opts, provider);
    expect(lines.some((l) => l.event === 'ai_circuit_open')).toBe(true);
    const card = router.log.summary();
    expect(card.circuitEvents).toHaveLength(1);
    expect(card.circuitEvents[0].model).toBe('pow-a');

    // circuit open: the sick model is not even tried
    calls.length = 0;
    await router.execute('org', 'campaign_build', opts, provider);
    expect(calls.map((c) => c.model)).toEqual(['fallback-b']);
    const last = router.log.recent().at(-1);
    expect(last).toMatchObject({
      model: 'fallback-b',
      reason: 'circuit_open',
      ok: true,
    });
    // the operator card sees the fallbacks
    const row = router.log
      .summary()
      .routes.find(
        (r) => r.task === 'campaign_build' && r.model === 'fallback-b',
      );
    expect(row?.fallbacks).toBe(3);
    expect(row?.circuitSkips).toBe(1);
  });

  it('a non-retryable error is thrown at once and never trips the circuit', async () => {
    const { router, lines } = makeRouter();
    const provider: AIProvider = {
      name: 'gemini',
      generate: () => Promise.reject(new Error('400 bad request')),
    };
    await expect(
      router.execute('org', 'reply_draft', opts, provider),
    ).rejects.toThrow('400 bad request');
    expect(lines.filter((l) => l.event === 'ai_circuit_open')).toHaveLength(0);
  });

  it('all models busy → a clear 503 after 3 attempts', async () => {
    const { router } = makeRouter();
    const { provider, calls } = fakeProvider(new Set(['bal-a', 'fallback-b']));
    await expect(
      router.execute('org', 'reply_draft', opts, provider),
    ).rejects.toMatchObject({ status: 503 });
    expect(calls).toHaveLength(3);
  });

  it('allowFallback=false tasks never leave their model', async () => {
    const { router } = makeRouter();
    const saved = TASK_CATALOGUE.reply_draft.allowFallback;
    TASK_CATALOGUE.reply_draft.allowFallback = false;
    try {
      const { provider, calls } = fakeProvider(new Set(['bal-a']));
      await expect(
        router.execute('org', 'reply_draft', opts, provider),
      ).rejects.toMatchObject({ status: 503 });
      expect(new Set(calls.map((c) => c.model))).toEqual(new Set(['bal-a']));
    } finally {
      TASK_CATALOGUE.reply_draft.allowFallback = saved;
    }
  });

  it('keeps the call-site tier and token cap, and fills task defaults', async () => {
    const { router } = makeRouter();
    const seen: AIGenerateOptions[] = [];
    const provider: AIProvider = {
      name: 'gemini',
      generate: (o) => {
        seen.push(o);
        return Promise.resolve({
          text: 'x',
          usage: { inputTokens: 1, outputTokens: 1 },
          model: o.model ?? '',
          stopReason: null,
        });
      },
    };
    await router.execute(
      'org',
      'reply_classify',
      { ...opts, maxTokens: 123 },
      provider,
    );
    await router.execute('org', 'reply_classify', opts, provider);
    expect(seen[0].maxTokens).toBe(123);
    expect(seen[1].maxTokens).toBe(
      TASK_CATALOGUE.reply_classify.maxOutputTokens,
    );
    expect(seen[1].timeoutMs).toBe(TASK_CATALOGUE.reply_classify.timeoutMs);
  });

  it('non-Gemini providers pick their own model (no override, no breaker)', async () => {
    const { router, lines } = makeRouter();
    const seen: AIGenerateOptions[] = [];
    const provider: AIProvider = {
      name: 'mock',
      generate: (o) => {
        seen.push(o);
        return Promise.resolve({
          text: 'x',
          usage: { inputTokens: 1, outputTokens: 1 },
          model: 'mock',
          stopReason: null,
        });
      },
    };
    await router.execute('org', 'reply_draft', opts, provider);
    expect(seen[0].model).toBeUndefined();
    expect(lines[0]).toMatchObject({ chosen_model: 'mock', reason: 'policy' });
  });
});

describe('Budget', () => {
  const budgetOf = (tokens: number, cap = 1000, now = () => 0) =>
    new AiBudget(
      () => Promise.resolve(tokens),
      () => cap,
      now,
    );

  it('levels: ok under the cap, over at the cap, hard at 2x', async () => {
    expect(await budgetOf(999).level('o')).toBe('ok');
    expect(await budgetOf(1000).level('o')).toBe('over');
    expect(await budgetOf(2000).level('o')).toBe('hard');
  });

  it('caches the usage query for 60 s per org', async () => {
    let t = 0;
    const load = jest.fn(() => Promise.resolve(10));
    const b = new AiBudget(
      load,
      () => 1000,
      () => t,
    );
    await b.level('o');
    await b.level('o');
    expect(load).toHaveBeenCalledTimes(1);
    t = 61_000;
    await b.level('o');
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('a failing usage query never blocks AI', async () => {
    const b = new AiBudget(
      () => Promise.reject(new Error('db')),
      () => 1,
    );
    expect(await b.level('o')).toBe('ok');
  });

  it('downgrade: powerful → balanced → fast', () => {
    expect(downgradeTier('powerful')).toBe('balanced');
    expect(downgradeTier('balanced')).toBe('fast');
    expect(downgradeTier('fast')).toBe('fast');
  });

  it('over the cap: powerful runs on the balanced model (budget_downgrade)', async () => {
    const { router, lines } = makeRouter();
    router.useBudget(budgetOf(1500));
    const { provider, calls } = fakeProvider(new Set());
    await router.execute('org', 'campaign_build', opts, provider);
    expect(calls[0]).toMatchObject({ model: 'bal-a', tier: 'balanced' });
    expect(lines[0]).toMatchObject({
      chosen_model: 'bal-a',
      reason: 'budget_downgrade',
    });
  });

  it('over the cap: balanced runs on the fast model', async () => {
    const { router } = makeRouter();
    router.useBudget(budgetOf(1500));
    const { provider, calls } = fakeProvider(new Set());
    await router.execute('org', 'reply_draft', opts, provider);
    expect(calls[0]).toMatchObject({ model: 'fast-a', tier: 'fast' });
  });

  it('over 2x the cap: non-essential tasks get a clear 429, classification still runs', async () => {
    const { router } = makeRouter();
    router.useBudget(budgetOf(5000));
    const { provider } = fakeProvider(new Set());
    const err = await router
      .execute('org', 'campaign_build', opts, provider)
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(HttpException);
    expect((err as HttpException).getStatus()).toBe(429);
    expect((err as HttpException).message).toMatch(/AI daily limit reached/);
    await expect(
      router.execute('org', 'reply_classify', opts, provider),
    ).resolves.toMatchObject({ text: 'ok' });
  });
});

describe('AiService + router + safety wiring', () => {
  const pool = {
    connect: () => Promise.reject(new Error('no db')),
  } as unknown as Pool;

  it('without a task, the legacy path is used (existing behaviour)', async () => {
    const { provider, calls } = fakeProvider(new Set());
    const { router } = makeRouter();
    const svc = new AiService(
      pool,
      { resolve: () => provider } as never,
      router,
    );
    await svc.generate('org', 'legacy', opts);
    expect(calls[0].model).toBeUndefined();
  });

  it('withholds blocked AI output with a clear error', async () => {
    const { provider } = fakeProvider(new Set());
    const { router } = makeRouter();
    const safety = {
      name: 'fake',
      screenInput: jest.fn(),
      screenOutput: jest.fn(() =>
        Promise.resolve({
          verdict: 'blocked' as const,
          findings: [{ filter: 'rai' }],
          provider: 'fake',
        }),
      ),
    };
    const svc = new AiService(
      pool,
      { resolve: () => provider } as never,
      router,
      safety,
    );
    await expect(
      svc.generate('org', 'reply-draft', { ...opts, task: 'reply_draft' }),
    ).rejects.toThrow('AI output withheld by safety check');
    expect(safety.screenOutput).toHaveBeenCalledWith('ok', 'reply_draft');
    // classification is internal: its output is never screened
    safety.screenOutput.mockClear();
    await svc.generate('org', 'reply-classify', {
      ...opts,
      task: 'reply_classify',
    });
    expect(safety.screenOutput).not.toHaveBeenCalled();
  });
});

describe('policy with blank .env values', () => {
  it('a blank GEMINI_* value means "use the default", not an empty model name', () => {
    const blank = config({
      GEMINI_MODEL_POWERFUL: '',
      GEMINI_FALLBACK_MODEL: '',
    });
    expect(modelsForTier('gemini', 'powerful', blank)).toEqual([
      'gemini-3.5-flash-lite',
    ]);
    expect(
      modelsForTier('gemini', 'fast', config({ GEMINI_FALLBACK_MODEL: 'off' })),
    ).toEqual(['fast-a']);
    expect(modelsForTier('mock', 'fast', config())).toEqual([]);
  });
});
