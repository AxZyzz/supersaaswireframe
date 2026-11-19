import { ConfigService } from '@nestjs/config';
import type {
  GenerateContentParameters,
  GenerateContentResponse,
} from '@google/genai';
import { GeminiAIProvider } from './gemini.provider';

/** The Gemini adapter (google-stack): request shape in, AIResult out. */
describe('GeminiAIProvider', () => {
  const make = (env: Record<string, string> = {}) =>
    new GeminiAIProvider(new ConfigService(env));

  const reply = (
    over: Partial<GenerateContentResponse> & { text?: string } = {},
  ) =>
    ({
      text: 'hello',
      modelVersion: 'gemini-2.5-flash-001',
      candidates: [{ finishReason: 'STOP' }],
      usageMetadata: {
        promptTokenCount: 12,
        candidatesTokenCount: 5,
        thoughtsTokenCount: 20,
      },
      ...over,
    }) as unknown as GenerateContentResponse;

  it('maps messages, system prompt and JSON schema onto a Gemini request', async () => {
    const p = make();
    let sent: GenerateContentParameters | undefined;
    p.useGenerateFn((params) => {
      sent = params;
      return Promise.resolve(reply({ text: '{"body":"hi"}' }));
    });
    const schema = {
      type: 'object',
      properties: { body: { type: 'string' } },
      required: ['body'],
    };

    const r = await p.generate({
      system: 'Be brief.',
      tier: 'balanced',
      maxTokens: 800,
      jsonSchema: schema,
      messages: [
        { role: 'user', content: 'Q1' },
        { role: 'assistant', content: 'A1' },
        { role: 'user', content: 'Q2' },
      ],
    });

    expect(sent!.model).toBe('gemini-3.5-flash-lite');
    expect(sent!.contents).toEqual([
      { role: 'user', parts: [{ text: 'Q1' }] },
      { role: 'model', parts: [{ text: 'A1' }] },
      { role: 'user', parts: [{ text: 'Q2' }] },
    ]);
    expect(sent!.config).toMatchObject({
      systemInstruction: 'Be brief.',
      responseMimeType: 'application/json',
      responseJsonSchema: schema,
    });
    // thinking headroom so JSON isn't cut off by thought tokens
    expect(sent!.config!.maxOutputTokens).toBeGreaterThan(800);

    expect(r).toEqual({
      text: '{"body":"hi"}',
      usage: { inputTokens: 12, outputTokens: 25 }, // thoughts billed as output
      model: 'gemini-2.5-flash-001',
      stopReason: 'STOP',
    });
  });

  it('plain-text requests carry no JSON mode or system field', async () => {
    const p = make();
    let sent: GenerateContentParameters | undefined;
    p.useGenerateFn((params) => {
      sent = params;
      return Promise.resolve(reply());
    });
    await p.generate({ messages: [{ role: 'user', content: 'hi' }] });
    expect(sent!.config).not.toHaveProperty('responseMimeType');
    expect(sent!.config).not.toHaveProperty('systemInstruction');
  });

  it('picks the model per tier, overridable from env', async () => {
    const models: string[] = [];
    const p = make({ GEMINI_MODEL_POWERFUL: 'gemini-x-pro' });
    p.useGenerateFn((params) => {
      models.push(params.model);
      return Promise.resolve(reply());
    });
    for (const tier of ['fast', 'balanced', 'powerful'] as const) {
      await p.generate({ tier, messages: [{ role: 'user', content: 'x' }] });
    }
    expect(models).toEqual([
      'gemini-3.5-flash-lite',
      'gemini-3.5-flash-lite',
      'gemini-x-pro',
    ]);
  });

  it('an empty answer (e.g. safety block) is an error with the reason', async () => {
    const p = make();
    p.useGenerateFn(() =>
      Promise.resolve(
        reply({ text: '', candidates: [{ finishReason: 'SAFETY' }] } as never),
      ),
    );
    await expect(
      p.generate({
        tier: 'powerful',
        messages: [{ role: 'user', content: 'x' }],
      }),
    ).rejects.toThrow('finish reason: SAFETY');
  });

  it('falls back to a lighter model once when the model is overloaded', async () => {
    const tried: string[] = [];
    const p = make();
    p.useGenerateFn((params) => {
      tried.push(params.model);
      return params.model === 'gemini-3.8-flash'
        ? Promise.reject(
            new Error('{"error":{"code":503,"status":"UNAVAILABLE"}}'),
          )
        : Promise.resolve(reply({ modelVersion: params.model }));
    });
    const r = await p.generate({
      tier: 'powerful',
      messages: [{ role: 'user', content: 'x' }],
    });
    expect(tried).toEqual(['gemini-3.8-flash', 'gemini-3.5-flash-lite']);
    expect(r.model).toBe('gemini-3.5-flash-lite');
  });

  it('a timed-out call becomes a readable error and switches to the fallback', async () => {
    const tried: string[] = [];
    const p = make({ GEMINI_TIMEOUT_MS: '30000' });
    p.useGenerateFn((params) => {
      tried.push(params.model);
      if (params.model === 'gemini-3.8-flash') {
        const abort = new Error('This operation was aborted');
        abort.name = 'AbortError';
        return Promise.reject(abort);
      }
      return Promise.resolve(reply({ modelVersion: params.model }));
    });
    const r = await p.generate({
      tier: 'powerful',
      messages: [{ role: 'user', content: 'x' }],
    });
    expect(tried).toEqual(['gemini-3.8-flash', 'gemini-3.5-flash-lite']);
    expect(r.model).toBe('gemini-3.5-flash-lite');

    const both = make({ GEMINI_TIMEOUT_MS: '30000' });
    both.useGenerateFn(() => {
      const abort = new Error('aborted');
      abort.name = 'RequestAbortedError';
      return Promise.reject(abort);
    });
    await expect(
      both.generate({
        tier: 'powerful',
        messages: [{ role: 'user', content: 'x' }],
      }),
    ).rejects.toThrow('Gemini timed out after 30s');
  });

  it("Google's own deadline (504 DEADLINE_EXCEEDED) also falls back", async () => {
    const tried: string[] = [];
    const p = make();
    p.useGenerateFn((params) => {
      tried.push(params.model);
      return params.model === 'gemini-3.8-flash'
        ? Promise.reject(
            new Error(
              '{"error":{"code":504,"message":"Deadline expired before operation could complete.","status":"DEADLINE_EXCEEDED"}}',
            ),
          )
        : Promise.resolve(reply({ modelVersion: params.model }));
    });
    const r = await p.generate({
      tier: 'powerful',
      messages: [{ role: 'user', content: 'x' }],
    });
    expect(tried).toEqual(['gemini-3.8-flash', 'gemini-3.5-flash-lite']);
    expect(r.model).toBe('gemini-3.5-flash-lite');
  });

  it('does not fall back on other errors, or when disabled', async () => {
    const quota = make();
    quota.useGenerateFn(() =>
      Promise.reject(new Error('400 INVALID_ARGUMENT')),
    );
    await expect(
      quota.generate({
        tier: 'powerful',
        messages: [{ role: 'user', content: 'x' }],
      }),
    ).rejects.toThrow('INVALID_ARGUMENT');

    const tried: string[] = [];
    const off = make({ GEMINI_FALLBACK_MODEL: 'off' });
    off.useGenerateFn((params) => {
      tried.push(params.model);
      return Promise.reject(new Error('503 UNAVAILABLE'));
    });
    await expect(
      off.generate({
        tier: 'powerful',
        messages: [{ role: 'user', content: 'x' }],
      }),
    ).rejects.toThrow('UNAVAILABLE');
    expect(tried).toEqual(['gemini-3.8-flash']);
  });

  it('explains what to set when no key or project is configured', async () => {
    await expect(
      make().generate({
        tier: 'powerful',
        messages: [{ role: 'user', content: 'x' }],
      }),
    ).rejects.toThrow('GEMINI_API_KEY');
    await expect(
      make({ GEMINI_USE_VERTEX: 'true' }).generate({
        messages: [{ role: 'user', content: 'x' }],
      }),
    ).rejects.toThrow('GOOGLE_CLOUD_PROJECT');
  });
});
