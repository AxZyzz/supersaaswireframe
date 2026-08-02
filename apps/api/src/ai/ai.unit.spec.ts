import { ConfigService } from '@nestjs/config';
import { Pool } from 'pg';
import { AiService } from './ai.service';
import { classifyReply } from './prompts';
import { MockAIProvider } from './providers/mock.provider';
import { AIProviderResolver } from './providers/provider.resolver';

// Pure unit tests — no database, no network, no Docker. Exercises the mock
// provider, the driver resolver, and AiService orchestration (including the
// best-effort usage-logging swallow).

describe('MockAIProvider', () => {
  const mock = new MockAIProvider();

  it('returns schema-valid JSON for structured requests', async () => {
    const opts = classifyReply({ replyBody: 'yes please' });
    const res = await mock.generate(opts);
    const parsed = JSON.parse(res.text) as { classification: string };
    // first enum value is the deterministic mock pick
    expect(parsed.classification).toBe('interested');
    expect(res.usage.outputTokens).toBeGreaterThan(0);
    expect(res.model).toBe('mock');
  });

  it('echoes the last message for free-form requests', async () => {
    const res = await mock.generate({
      messages: [{ role: 'user', content: 'hello there' }],
    });
    expect(res.text).toContain('hello there');
    expect(res.stopReason).toBe('end_turn');
  });
});

describe('AIProviderResolver', () => {
  const mock = new MockAIProvider();
  // Bedrock provider is never invoked in these tests; a bare cast avoids
  // constructing a real client.
  const bedrock = {} as never;

  const resolverWith = (driver?: string) =>
    new AIProviderResolver(
      {
        get: (_k: string, d: string) => driver ?? d,
      } as unknown as ConfigService,
      mock,
      bedrock,
    );

  it('defaults to the mock provider', () => {
    expect(resolverWith().resolve().name).toBe('mock');
  });

  it('falls back to mock for an unknown driver', () => {
    expect(resolverWith('weird').resolve().name).toBe('mock');
  });
});

describe('AiService.generate', () => {
  it('returns the provider result even when usage logging fails', async () => {
    const mock = new MockAIProvider();
    const resolver = {
      resolve: () => mock,
    } as unknown as AIProviderResolver;
    // Pool whose connect() rejects — logUsage must swallow it.
    const pool = {
      connect: () => Promise.reject(new Error('no db')),
    } as unknown as Pool;

    const svc = new AiService(pool, resolver);
    const res = await svc.generate('org-1', 'test', {
      messages: [{ role: 'user', content: 'ping' }],
    });
    expect(res.text).toContain('ping');
    expect(res.model).toBe('mock');
  });
});
