import { ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GoogleAuth } from 'google-auth-library';
import {
  safetyLog,
  type SafetyFinding,
  type SafetyInputContext,
  type SafetyResult,
  type SafetyScreen,
} from './safety-screen';

/** The two Model Armor calls we use. A fake implements this in tests. */
export interface ModelArmorClient {
  sanitizeUserPrompt(text: string): Promise<unknown>;
  sanitizeModelResponse(text: string): Promise<unknown>;
}

const TIMEOUT_MS = 5_000;

/** REST client (no extra SDK): Application Default Credentials. */
export class RestModelArmorClient implements ModelArmorClient {
  private auth: GoogleAuth | null = null;

  constructor(
    private readonly templatePath: string,
    private readonly location: string,
  ) {}

  private async call(method: string, body: unknown): Promise<unknown> {
    this.auth ??= new GoogleAuth({
      scopes: ['https://www.googleapis.com/auth/cloud-platform'],
    });
    const client = await this.auth.getClient();
    const url = `https://modelarmor.${this.location}.rep.googleapis.com/v1/${this.templatePath}:${method}`;
    const res = await client.request({
      url,
      method: 'POST',
      data: body,
      timeout: TIMEOUT_MS,
    });
    return res.data;
  }

  sanitizeUserPrompt(text: string) {
    return this.call('sanitizeUserPrompt', { user_prompt_data: { text } });
  }
  sanitizeModelResponse(text: string) {
    return this.call('sanitizeModelResponse', {
      model_response_data: { text },
    });
  }
}

/** Sensitive-data hits mark a message for a human; everything else blocks. */
const FLAG_ONLY = new Set(['sdp']);

function hasMatch(node: unknown): boolean {
  if (!node || typeof node !== 'object') return false;
  const o = node as Record<string, unknown>;
  if (o.matchState === 'MATCH_FOUND') return true;
  return Object.values(o).some(hasMatch);
}

/** Turns Model Armor's response into a verdict. Exported for tests. */
export function parseSanitization(
  data: unknown,
  provider: string,
): SafetyResult {
  const sr = (data as { sanitizationResult?: Record<string, unknown> } | null)
    ?.sanitizationResult;
  if (!sr || typeof sr !== 'object') {
    throw new Error('Model Armor returned no sanitizationResult');
  }
  const results = (sr.filterResults ?? {}) as Record<string, unknown>;
  const findings: SafetyFinding[] = Object.entries(results)
    .filter(([, v]) => hasMatch(v))
    .map(([filter]) => ({ filter }));
  if (findings.length === 0) {
    const inv = sr.invocationResult;
    if (inv && inv !== 'SUCCESS') {
      throw new Error(`Model Armor invocation ${JSON.stringify(inv)}`);
    }
    return { verdict: 'ok', findings: [], provider };
  }
  const blocked = findings.some((f) => !FLAG_ONLY.has(f.filter));
  return { verdict: blocked ? 'blocked' : 'flagged', findings, provider };
}

/**
 * Google Cloud Model Armor. Template (prompt-injection ENFORCE, basic SDP
 * ENFORCE, malicious URIs, RAI medium) is created once by a person: see
 * infra/model-armor/README.md. SAFETY_FAIL_MODE=open (default) keeps AI
 * working if Model Armor is down (error log + counter); `closed` refuses.
 */
export class ModelArmorSafetyScreen implements SafetyScreen {
  readonly name = 'modelarmor';
  /** Screen failures since boot (fail-open path). */
  errorCount = 0;
  private client: ModelArmorClient | null;

  constructor(
    private readonly config: ConfigService,
    client?: ModelArmorClient,
  ) {
    this.client = client ?? null;
  }

  private failClosed(): boolean {
    return (
      this.config.get<string>('SAFETY_FAIL_MODE', 'open').toLowerCase() ===
      'closed'
    );
  }

  private api(): ModelArmorClient {
    if (!this.client) {
      const location = this.config.get<string>(
        'MODEL_ARMOR_LOCATION',
        'us-central1',
      );
      const template = this.config.get<string>('MODEL_ARMOR_TEMPLATE', '');
      const project = this.config.get<string>('GOOGLE_CLOUD_PROJECT', '');
      const path = template.startsWith('projects/')
        ? template
        : `projects/${project}/locations/${location}/templates/${template}`;
      this.client = new RestModelArmorClient(path, location);
    }
    return this.client;
  }

  async screenInput(
    text: string,
    context: SafetyInputContext,
  ): Promise<SafetyResult> {
    return this.run('input', context, () =>
      this.api().sanitizeUserPrompt(text),
    );
  }

  async screenOutput(text: string, context: string): Promise<SafetyResult> {
    return this.run('output', context, () =>
      this.api().sanitizeModelResponse(text),
    );
  }

  private async run(
    direction: 'input' | 'output',
    context: string,
    call: () => Promise<unknown>,
  ): Promise<SafetyResult> {
    try {
      const result = parseSanitization(await call(), this.name);
      if (result.verdict !== 'ok') {
        safetyLog(result.verdict === 'blocked' ? 'WARNING' : 'INFO', {
          event: 'safety_screen',
          direction,
          context,
          verdict: result.verdict,
          findings: result.findings.map((f) => f.filter),
          provider: this.name,
        });
      }
      return result;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.errorCount += 1;
      safetyLog('ERROR', {
        event: 'safety_screen_error',
        direction,
        context,
        fail_mode: this.failClosed() ? 'closed' : 'open',
        error_count: this.errorCount,
        message: message.slice(0, 200),
      });
      if (this.failClosed()) {
        throw new ServiceUnavailableException(
          'The safety check is unavailable right now. Please try again shortly.',
        );
      }
      return { verdict: 'ok', findings: [], provider: this.name };
    }
  }
}
