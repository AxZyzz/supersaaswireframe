import { createServer, type Server } from 'http';
import type { AddressInfo } from 'net';
import express from 'express';
import { Role } from '@a2a-js/sdk';
import {
  AgentEvent,
  DefaultRequestHandler,
  InMemoryTaskStore,
  type AgentExecutor,
  type ExecutionEventBus,
  type RequestContext,
} from '@a2a-js/sdk/server';
import {
  UserBuilder,
  agentCardHandler,
  jsonRpcHandler,
} from '@a2a-js/sdk/server/express';

/**
 * A fake A2A agent for Jest, built on the A2A SDK's own server side so the wire format is exactly
 * what the real client speaks. No Python, no network beyond localhost. `respond` gets the text
 * the API sent and the request headers, and returns the agent's answer (or throws).
 */
export interface FakeAgentCall {
  text: string;
  headers: Record<string, string | string[] | undefined>;
}

export interface FakeAgent {
  url: string;
  calls: FakeAgentCall[];
  close(): Promise<void>;
}

export async function startFakeAgent(
  respond: (call: FakeAgentCall) => string | Promise<string>,
): Promise<FakeAgent> {
  const calls: FakeAgentCall[] = [];
  let currentHeaders: FakeAgentCall['headers'] = {};

  const executor: AgentExecutor = {
    execute: async (ctx: RequestContext, bus: ExecutionEventBus) => {
      const parts = ctx.userMessage.parts;
      const text = parts
        .map((p) => (p.content?.$case === 'text' ? p.content.value : ''))
        .join('');
      const call = { text, headers: currentHeaders };
      calls.push(call);
      const answer = await respond(call);
      bus.publish(
        AgentEvent.message({
          messageId: `m-${calls.length}`,
          role: Role.ROLE_AGENT,
          parts: [
            {
              content: { $case: 'text', value: answer },
              metadata: undefined,
              filename: '',
              mediaType: 'text/plain',
            },
          ],
          taskId: ctx.taskId,
          contextId: ctx.contextId,
          extensions: [],
          metadata: {},
          referenceTaskIds: [],
        }),
      );
      bus.finished();
    },
    cancelTask: () => Promise.resolve(),
  };

  const app = express();
  let base = '';
  const card = () => ({
    name: 'fake-agent',
    description: 'Fake agent for tests',
    version: '1.0.0',
    supportedInterfaces: [
      {
        url: base,
        protocolBinding: 'JSONRPC',
        protocolVersion: '1.0',
        tenant: '',
      },
    ],
    provider: undefined,
    capabilities: {
      streaming: false,
      pushNotifications: false,
      extensions: [],
    },
    securitySchemes: {},
    securityRequirements: [],
    defaultInputModes: ['text/plain'],
    defaultOutputModes: ['text/plain'],
    skills: [],
    signatures: [],
  });
  // the card is built lazily: the port is only known after listen()
  const handler = new DefaultRequestHandler(
    card(),
    new InMemoryTaskStore(),
    executor,
  );
  app.use((req, _res, next) => {
    currentHeaders = req.headers;
    next();
  });
  app.use(
    '/.well-known/agent-card.json',
    agentCardHandler({
      agentCardProvider: {
        getAgentCard: () => Promise.resolve(card() as never),
      },
    }),
  );
  app.use(
    '/',
    jsonRpcHandler({
      requestHandler: handler,
      userBuilder: UserBuilder.noAuthentication,
    }),
  );

  const server: Server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return {
    url: base,
    calls,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections?.();
        server.close(() => resolve());
      }),
  };
}
