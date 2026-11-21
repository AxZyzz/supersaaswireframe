import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomBytes, randomUUID } from 'crypto';
import { GoogleAuth } from 'google-auth-library';
import { currentTraceparent, withSpan } from '../tracing/spans';
import type { Client } from '@a2a-js/sdk/client';
import {
  CircuitBreaker,
  RedisCircuitStore,
  type CircuitStore,
} from '../ai/router/circuit-breaker';

export type AgentName = 'review-analyst' | 'copywriter' | 'discover';

export interface A2aResult {
  /** The agent's answer, parsed from JSON. The caller still validates it. */
  output: unknown;
  /** W3C trace id sent as `traceparent`: one Cloud Trace shows API -> agent -> Gemini. */
  traceId: string;
  latencyMs: number;
}

/** The agent could not be reached or did not answer in time (callers fall back). */
export class A2aUnavailableError extends Error {
  constructor(
    message: string,
    readonly traceId: string | null = null,
  ) {
    super(message);
    this.name = 'A2aUnavailableError';
  }
}

// The A2A SDK is loaded on first use, not at boot: its CommonJS build requires `jose`, which is
// ESM-only (fine on Node >= 22.12, which the Dockerfile uses, but the API must boot without it).
/* eslint-disable @typescript-eslint/no-require-imports */
function loadSdk() {
  const root = require('@a2a-js/sdk') as typeof import('@a2a-js/sdk');
  const client =
    require('@a2a-js/sdk/client') as typeof import('@a2a-js/sdk/client');
  return { Role: root.Role, ...client };
}
/* eslint-enable @typescript-eslint/no-require-imports */

const TIMEOUT_MS = 30_000;
const CLIENT_TTL_MS = 5 * 60_000;
const ENV_URL: Record<AgentName, string> = {
  'review-analyst': 'REVIEW_ANALYST_URL',
  copywriter: 'COPYWRITER_URL',
  discover: 'DISCOVER_AGENT_URL',
};

const isLocal = (url: string) =>
  /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])/i.test(url);

/** Text of the answer: a Task's artifacts, else its status message, else a Message. */
export function answerText(result: unknown): string {
  type PartLike = { content?: { $case?: string; value?: unknown } };
  const text = (parts: PartLike[] | undefined) =>
    (parts ?? [])
      .map((p) => (p.content?.$case === 'text' ? String(p.content.value) : ''))
      .join('');
  const r = result as {
    artifacts?: Array<{ parts?: PartLike[] }>;
    status?: { message?: { parts?: PartLike[] } };
    parts?: PartLike[];
  };
  const fromArtifacts = (r.artifacts ?? []).map((a) => text(a.parts)).join('');
  return fromArtifacts || text(r.status?.message?.parts) || text(r.parts);
}

/** JSON out of a model answer, tolerating a ```json fence. */
export function parseJsonAnswer(raw: string): unknown {
  const t = raw.trim();
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(t);
  return JSON.parse(fenced ? fenced[1] : t);
}

function traceparent(): { header: string; traceId: string } {
  const traceId = randomBytes(16).toString('hex');
  return {
    header: `00-${traceId}-${randomBytes(8).toString('hex')}-01`,
    traceId,
  };
}

/**
 * Calls the Python agents (apps/agents) over the A2A protocol. 30 s timeout, one retry, and the
 * T08 circuit breaker (keys `a2a:<agent>`): after repeated failures the agent is skipped for a
 * few minutes and callers use their fallback straight away. Auth: a Google access token from
 * Application Default Credentials for non-local URLs. Jest never reaches Google or Agent Engine:
 * tests point this at a fake local server.
 */
@Injectable()
export class A2aClientService implements OnModuleDestroy {
  private readonly logger = new Logger(A2aClientService.name);
  private readonly clients = new Map<string, { client: Client; at: number }>();
  private breaker: CircuitBreaker | null = null;
  private redisStore: RedisCircuitStore | null = null;
  private auth: GoogleAuth | null = null;
  /** Tests set these small/zero. */
  timeoutMs = TIMEOUT_MS;
  retryDelayMs = 400;
  /** Per agent URL: Discover is a whole search, so it gets minutes, not seconds (T10). */
  private readonly timeouts = new Map<string, number>();

  constructor(private readonly config: ConfigService) {}

  async onModuleDestroy() {
    await this.redisStore?.close();
  }

  useCircuitStore(store: CircuitStore) {
    this.breaker = new CircuitBreaker(store);
  }

  private circuit(): CircuitBreaker {
    if (!this.breaker) {
      this.redisStore = new RedisCircuitStore(this.config);
      this.breaker = new CircuitBreaker(this.redisStore);
    }
    return this.breaker;
  }

  urlFor(agent: AgentName): string | null {
    const v = this.config.get<string>(ENV_URL[agent])?.trim();
    return v ? v.replace(/\/+$/, '') : null;
  }

  private async token(): Promise<string | null> {
    try {
      this.auth ??= new GoogleAuth({
        scopes: ['https://www.googleapis.com/auth/cloud-platform'],
      });
      return (await this.auth.getAccessToken()) ?? null;
    } catch (e) {
      this.logger.warn(`no Google access token: ${(e as Error).message}`);
      return null;
    }
  }

  /** fetch that adds the bearer token (non-local URLs). */
  private fetchFor(url: string): typeof fetch {
    return async (input: string | URL | Request, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      if (!isLocal(url) && this.config.get<string>('A2A_AUTH') !== 'none') {
        const t = await this.token();
        if (t) headers.set('Authorization', `Bearer ${t}`);
      }
      return fetch(input, {
        ...init,
        headers,
        signal:
          init?.signal ??
          AbortSignal.timeout(this.timeouts.get(url) ?? this.timeoutMs),
      });
    };
  }

  private async clientFor(url: string): Promise<Client> {
    const hit = this.clients.get(url);
    if (hit && Date.now() - hit.at < CLIENT_TTL_MS) return hit.client;
    const fetchImpl = this.fetchFor(url);
    const {
      ClientFactory,
      ClientFactoryOptions,
      DefaultAgentCardResolver,
      JsonRpcTransportFactory,
    } = loadSdk();
    const factory = new ClientFactory(
      ClientFactoryOptions.createFrom(ClientFactoryOptions.default, {
        transports: [
          // legacyCompat: Agent Engine and older servers may still speak A2A 0.3
          new JsonRpcTransportFactory({
            fetchImpl,
            legacyCompat: { enabled: true },
          }),
        ],
        cardResolver: new DefaultAgentCardResolver({
          fetchImpl,
          legacyCompat: { enabled: true },
        }),
      }),
    );
    const cardPath = this.config.get<string>('A2A_CARD_PATH')?.trim();
    const client = await factory.createFromUrl(url, cardPath || undefined);
    this.clients.set(url, { client, at: Date.now() });
    return client;
  }

  private async once(
    url: string,
    payload: unknown,
    tp: string,
  ): Promise<unknown> {
    const client = await this.clientFor(url);
    const result = await client.sendMessage(
      {
        tenant: '',
        metadata: {},
        configuration: undefined,
        message: {
          messageId: randomUUID(),
          role: loadSdk().Role.ROLE_USER,
          parts: [
            {
              content: { $case: 'text', value: JSON.stringify(payload) },
              metadata: undefined,
              filename: '',
              mediaType: 'text/plain',
            },
          ],
          taskId: '',
          contextId: '',
          extensions: [],
          metadata: {},
          referenceTaskIds: [],
        },
      },
      // per call, so each call carries its own trace id (the card/client is cached)
      { serviceParameters: { traceparent: tp } },
    );
    const text = answerText(result);
    if (!text.trim()) throw new Error('the agent returned no text');
    return parseJsonAnswer(text);
  }

  /** One span per agent call (a no-op with tracing off). */
  call(agent: AgentName, payload: unknown): Promise<A2aResult> {
    return withSpan(`a2a.${agent}`, () => this.callTraced(agent, payload));
  }

  private async callTraced(
    agent: AgentName,
    payload: unknown,
  ): Promise<A2aResult> {
    const url = this.urlFor(agent);
    if (!url) {
      throw new A2aUnavailableError(`${ENV_URL[agent]} is not set`);
    }
    if (agent === 'discover') {
      const n = Number(this.config.get<string>('DISCOVER_AGENT_TIMEOUT_MS'));
      this.timeouts.set(url, Number.isFinite(n) && n >= 1000 ? n : 300_000);
    }
    const key = `a2a:${agent}`;
    // with tracing on this is the live trace (API -> agent -> model in one
    // Cloud Trace); with it off, a fresh random id as before
    const { header, traceId } = currentTraceparent() ?? traceparent();
    if (await this.circuit().isOpen(key)) {
      throw new A2aUnavailableError(`${agent} circuit is open`, traceId);
    }
    const started = Date.now();
    let lastErr: unknown;
    // a whole Discover search is not retried: the caller falls back to the native pipeline
    const attempts = agent === 'discover' ? 1 : 2;
    for (let attempt = 0; attempt < attempts; attempt++) {
      try {
        const output = await this.once(url, payload, header);
        const latencyMs = Date.now() - started;
        // one log line per agent call; the trace id finds the span in Cloud Trace
        this.logger.log(
          JSON.stringify({
            event: 'a2a_call',
            agent,
            trace_id: traceId,
            attempt: attempt + 1,
            latency_ms: latencyMs,
            ok: true,
          }),
        );
        return { output, traceId, latencyMs };
      } catch (e) {
        lastErr = e;
        this.clients.delete(url); // re-read the card next time
        if (await this.circuit().recordFailure(key)) {
          this.logger.warn(
            JSON.stringify({
              event: 'a2a_circuit_open',
              agent,
              trace_id: traceId,
            }),
          );
        }
        if (attempt === 0)
          await new Promise((r) => setTimeout(r, this.retryDelayMs));
      }
    }
    const message =
      lastErr instanceof Error ? lastErr.message : String(lastErr);
    this.logger.warn(
      JSON.stringify({
        event: 'a2a_call',
        agent,
        trace_id: traceId,
        latency_ms: Date.now() - started,
        ok: false,
        error: message.slice(0, 200),
      }),
    );
    throw new A2aUnavailableError(
      `${agent} did not answer: ${message}`,
      traceId,
    );
  }
}
