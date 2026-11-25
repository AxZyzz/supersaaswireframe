import { ConfigService } from '@nestjs/config';
import { MemoryCircuitStore } from '../ai/router/circuit-breaker';
import {
  A2aClientService,
  A2aUnavailableError,
  answerText,
  parseJsonAnswer,
} from './a2a-client.service';
import { startFakeAgent, type FakeAgent } from './fake-a2a-agent';

const make = (env: Record<string, string> = {}) => {
  const svc = new A2aClientService({
    get: (k: string) => env[k],
  } as unknown as ConfigService);
  svc.useCircuitStore(new MemoryCircuitStore());
  svc.retryDelayMs = 0;
  svc.timeoutMs = 2000;
  return svc;
};

describe('A2A client (against a fake agent over real HTTP, no Agent Engine)', () => {
  let agent: FakeAgent | null = null;
  afterEach(async () => {
    await agent?.close();
    agent = null;
  });

  it('sends the payload as JSON text with a W3C traceparent and returns the parsed answer', async () => {
    agent = await startFakeAgent(() => JSON.stringify({ hello: 'world' }));
    const svc = make({ REVIEW_ANALYST_URL: agent.url });
    const r = await svc.call('review-analyst', { reviewId: 'r1' });
    expect(r.output).toEqual({ hello: 'world' });
    expect(r.traceId).toMatch(/^[0-9a-f]{32}$/);
    expect(JSON.parse(agent.calls[0].text)).toEqual({ reviewId: 'r1' });
    // one trace id per call, carried to the agent as `traceparent`
    expect(agent.calls[0].headers.traceparent).toBe(
      `00-${r.traceId}-${String(agent.calls[0].headers.traceparent).split('-')[2]}-01`,
    );
    const r2 = await svc.call('review-analyst', { reviewId: 'r2' });
    expect(r2.traceId).not.toBe(r.traceId);
    expect(agent.calls[1].headers.traceparent).toContain(r2.traceId);
  });

  it('accepts an answer wrapped in a ```json fence', async () => {
    agent = await startFakeAgent(() => '```json\n{"a":1}\n```');
    const r = await make({ COPYWRITER_URL: agent.url }).call('copywriter', {});
    expect(r.output).toEqual({ a: 1 });
  });

  it('retries once, then succeeds', async () => {
    let n = 0;
    agent = await startFakeAgent(() => {
      if (++n === 1) throw new Error('boom');
      return '{"ok":true}';
    });
    const r = await make({ REVIEW_ANALYST_URL: agent.url }).call(
      'review-analyst',
      {},
    );
    expect(r.output).toEqual({ ok: true });
    expect(agent.calls).toHaveLength(2);
  });

  it('a dead agent is a clean A2aUnavailableError (callers fall back)', async () => {
    agent = await startFakeAgent(() => '{}');
    const url = agent.url;
    await agent.close();
    agent = null;
    const err = await make({ REVIEW_ANALYST_URL: url })
      .call('review-analyst', {})
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(A2aUnavailableError);
    expect((err as A2aUnavailableError).traceId).toMatch(/^[0-9a-f]{32}$/);
  });

  it('an unset URL is unavailable, not a crash', async () => {
    await expect(make().call('copywriter', {})).rejects.toBeInstanceOf(
      A2aUnavailableError,
    );
  });

  it('an answer that is not JSON is an error the caller falls back from', async () => {
    agent = await startFakeAgent(() => 'sorry, I cannot do that');
    await expect(
      make({ REVIEW_ANALYST_URL: agent.url }).call('review-analyst', {}),
    ).rejects.toBeInstanceOf(A2aUnavailableError);
  });

  it('3 failures open the circuit: the next call is skipped without touching the agent', async () => {
    agent = await startFakeAgent(() => {
      throw new Error('down');
    });
    const svc = make({ REVIEW_ANALYST_URL: agent.url });
    await svc.call('review-analyst', {}).catch(() => undefined); // 2 attempts
    await svc.call('review-analyst', {}).catch(() => undefined); // trips on the 3rd failure
    const seen = agent.calls.length;
    const err = await svc.call('review-analyst', {}).catch((e: unknown) => e);
    expect((err as Error).message).toMatch(/circuit is open/);
    expect(agent.calls.length).toBe(seen);
  });
});

describe('answer parsing', () => {
  it('reads text from artifacts, then status message, then a message', () => {
    const part = (v: string) => ({ content: { $case: 'text', value: v } });
    expect(answerText({ artifacts: [{ parts: [part('{"a":1}')] }] })).toBe(
      '{"a":1}',
    );
    expect(answerText({ status: { message: { parts: [part('x')] } } })).toBe(
      'x',
    );
    expect(answerText({ parts: [part('y')] })).toBe('y');
    expect(answerText({})).toBe('');
  });

  it('parses JSON with or without a fence', () => {
    expect(parseJsonAnswer(' {"a":1} ')).toEqual({ a: 1 });
    expect(parseJsonAnswer('```\n{"a":2}\n```')).toEqual({ a: 2 });
    expect(() => parseJsonAnswer('nope')).toThrow();
  });
});
