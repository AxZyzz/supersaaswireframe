import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SAFETY_SCREEN, type SafetyScreen } from '../ai/safety/safety-screen';
import {
  AiChallengerDrafter,
  completeCandidates,
  type ChallengerCandidate,
  type ChallengerDraftInput,
  type ChallengerDrafter,
  validateSubjects,
} from '../review/challenger-drafter';
import { TEMPLATE_VARS } from '../templates/render';
import { A2aClientService } from './a2a-client.service';
import {
  contractError,
  type CopywriterInput,
  type CopywriterOutput,
} from './contracts';

export type CopywriterDriver = 'agent' | 'gemini' | 'mock';

/** Longest subject the Copywriter may write (the brief's constraint). */
export const COPYWRITER_MAX_CHARS = 60;
const TOKEN = /\{([^{}]*)\}/g;

/**
 * Merge tokens must be well formed and use variables the sender knows ({first_name|there}).
 * A stray brace or an unknown variable would go out to a real person as literal text.
 */
export function mergeTokensOk(subject: string): boolean {
  const stripped = subject.replace(TOKEN, (_m, inner: string) => {
    const m = /^(\w+)(?:\|[^}]*)?$/.exec(inner);
    return m && (TEMPLATE_VARS as readonly string[]).includes(m[1])
      ? ''
      : '\u0000';
  });
  return !stripped.includes('\u0000') && !/[{}]/.test(stripped);
}

/**
 * The Copywriter (T09) behind the T11 CHALLENGER_DRAFTER seam. COPYWRITER_DRIVER:
 *  - gemini (default): the existing direct-Gemini drafter (also what happens under AI_DRIVER=mock);
 *  - agent: the ADK Copywriter over A2A, validated and screened here;
 *  - mock: deterministic template subjects, no AI at all (tests).
 * Nothing here applies or sends anything: callers store the choice as a draft.
 * On any agent failure the Gemini drafter (then the templates) takes over.
 */
@Injectable()
export class AgentChallengerDrafter implements ChallengerDrafter {
  private readonly logger = new Logger(AgentChallengerDrafter.name);

  constructor(
    private readonly config: ConfigService,
    private readonly a2a: A2aClientService,
    private readonly gemini: AiChallengerDrafter,
    @Optional()
    @Inject(SAFETY_SCREEN)
    private readonly safety?: SafetyScreen,
  ) {}

  driver(): CopywriterDriver {
    const v = this.config
      .get<string>('COPYWRITER_DRIVER')
      ?.trim()
      .toLowerCase();
    return v === 'agent' || v === 'mock' ? v : 'gemini';
  }

  async draft(input: ChallengerDraftInput): Promise<ChallengerCandidate[]> {
    switch (this.driver()) {
      case 'mock':
        return completeCandidates([], input, 'mock').map((c) => ({
          ...c,
          source: 'mock' as const,
        }));
      case 'gemini':
        return this.gemini.draft(input);
      case 'agent':
        try {
          return await this.viaAgent(input);
        } catch (e) {
          this.logger.warn(
            `Copywriter agent failed, using the Gemini drafter: ${(e as Error).message}`,
          );
          return this.gemini.draft(input);
        }
    }
  }

  private async viaAgent(
    input: ChallengerDraftInput,
  ): Promise<ChallengerCandidate[]> {
    const request: CopywriterInput = {
      offer: {
        name: input.offerName ?? 'Our offer',
        ...(input.offerDescription
          ? { description: input.offerDescription.slice(0, 500) }
          : {}),
      },
      kb: (input.kb ?? '').slice(0, 2000),
      control: { subject: input.baseSubject || 'Quick question' },
      currentWinner: input.baseSubject
        ? { subject: input.baseSubject }
        : undefined,
      losingSubjects: input.avoid.filter((s) => s !== input.baseSubject),
      constraints: {
        maxChars: COPYWRITER_MAX_CHARS,
        keepMergeTokens: true,
        language: 'en',
      },
      playbooks: [], // T14 fills this
    };
    const bad = contractError('copywriter.input', request);
    if (bad) throw new Error(`bad Copywriter input: ${bad}`);

    const { output, traceId } = await this.a2a.call('copywriter', request);
    const schemaError = contractError('copywriter.output', output);
    if (schemaError)
      throw new Error(`Copywriter output is invalid: ${schemaError}`);
    const subjects = (output as CopywriterOutput).candidates.map(
      (c) => c.subject,
    );

    // keep only distinct, new, short, well-formed subjects
    const ok = validateSubjects(subjects, input.avoid).filter(
      (s) => s.length <= COPYWRITER_MAX_CHARS && mergeTokensOk(s),
    );

    if (this.safety && ok.length > 0) {
      const screened = await this.safety.screenOutput(
        ok.join('\n'),
        'challenger_draft',
      );
      if (screened.verdict === 'blocked') {
        throw new Error('Copywriter output withheld by safety check');
      }
    }
    this.logger.log(
      JSON.stringify({
        event: 'copywriter_drafts',
        trace_id: traceId,
        proposed: subjects.length,
        kept: ok.length,
      }),
    );
    // templates top up anything the checks removed, so there are always 3
    return completeCandidates(ok, input, 'agent');
  }
}
