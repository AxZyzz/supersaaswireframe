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

    expect(sent!.model).toBe('gemini-2.5-flash');
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
      'gemini-2.5-flash-lite',
      'gemini-2.5-flash',
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
      p.generate({ messages: [{ role: 'user', content: 'x' }] }),
    ).rejects.toThrow('finish reason: SAFETY');
  });

  it('explains what to set when no key or project is configured', async () => {
    await expect(
      make().generate({ messages: [{ role: 'user', content: 'x' }] }),
    ).rejects.toThrow('GEMINI_API_KEY');
    await expect(
      make({ GEMINI_USE_VERTEX: 'true' }).generate({
        messages: [{ role: 'user', content: 'x' }],
      }),
    ).rejects.toThrow('GOOGLE_CLOUD_PROJECT');
  });
});
