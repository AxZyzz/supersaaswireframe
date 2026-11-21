import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AiService } from '../ai/ai.service';
import { SAFETY_SCREEN, type SafetyScreen } from '../ai/safety/safety-screen';
import { explain, type Explanation } from '../review/policy/explain-template';
import type { ReviewResult } from '../review/policy';
import { A2aClientService } from './a2a-client.service';
import {
  CONTRACT_SCHEMAS,
  type ReviewAnalystInput,
  type ReviewAnalystOutput,
} from './contracts';
import { buildEvidencePackage } from './evidence';
import { validateExplanation } from './explanation-validator';
import {
  REVIEW_ANALYST_INSTRUCTION,
  REVIEW_PROMPT_VERSION,
} from './review-prompt';

export type ExplainerMode = 'agent' | 'gemini' | 'template';
export type ExplanationSource = 'agent' | 'gemini' | 'template';

/** What is stored in reviews.explanation (a superset of the template's shape). */
export interface StoredExplanation extends Explanation {
  caveats?: string[];
  suggestedNextStep?: ReviewAnalystOutput['suggestedNextStep'];
  /** Why the template was used instead of the AI (only when the AI was asked). */
  fallbackReason?: string;
  traceId?: string;
}

export interface ExplainOutcome {
  explanation: StoredExplanation;
  source: ExplanationSource;
}

/** JSON-mode schema for Gemini: the contract minus the keys Gemini does not accept. */
function geminiSchema(): Record<string, unknown> {
  const {
    $schema: _s,
    $id: _i,
    ...rest
  } = CONTRACT_SCHEMAS['review-analyst.output'];
  void _s;
  void _i;
  return rest;
}

/**
 * Plain-words explanation of a review. Code decided; this only explains. Modes (REVIEW_EXPLAINER):
 *  - template (default): the deterministic T04 text, no AI.
 *  - agent: the ADK Review analyst over A2A.
 *  - gemini: the same instruction as a direct AiService call (local dev without Agent Engine).
 * Whatever the AI says is verified (explanation-validator.ts); on ANY failure (unreachable,
 * slow, invalid JSON, a wrong id or number, a forbidden word) the template is used and the reason
 * is stored beside it. Simulated reviews always use the template.
 */
@Injectable()
export class ReviewExplainerService {
  private readonly logger = new Logger(ReviewExplainerService.name);
  /** Test seam: swap the evidence builder. */
  buildEvidence = buildEvidencePackage;

  constructor(
    private readonly config: ConfigService,
    private readonly a2a: A2aClientService,
    private readonly ai: AiService,
    @Optional()
    @Inject(SAFETY_SCREEN)
    private readonly safety?: SafetyScreen,
  ) {}

  mode(): ExplainerMode {
    const v = this.config.get<string>('REVIEW_EXPLAINER')?.trim().toLowerCase();
    return v === 'agent' || v === 'gemini' ? v : 'template';
  }

  async explain(
    orgId: string,
    reviewId: string,
    revision: number,
    result: ReviewResult & { slices?: unknown },
  ): Promise<ExplainOutcome> {
    const template = explain(result);
    const mode = this.mode();
    if (mode === 'template' || result.simulated) {
      return { explanation: template, source: 'template' };
    }
    const evidence = this.buildEvidence(reviewId, revision, result);
    let traceId: string | undefined;
    try {
      let raw: unknown;
      if (mode === 'agent') {
        const r = await this.a2a.call('review-analyst', evidence);
        raw = r.output;
        traceId = r.traceId;
      } else {
        raw = await this.viaGemini(orgId, evidence);
      }
      const check = validateExplanation(raw, evidence);
      if (!check.ok) return this.fallback(template, check.reason, traceId);
      // gemini mode is screened inside AiService; the agent's answer is screened here
      if (mode === 'agent' && this.safety) {
        const text = [
          check.explanation.summary,
          ...check.explanation.points.map((p) => p.text),
          ...check.explanation.caveats,
        ].join(String.fromCharCode(10));
        const screened = await this.safety.screenOutput(text, 'review_explain');
        if (screened.verdict === 'blocked') {
          return this.fallback(template, 'withheld by safety check', traceId);
        }
      }
      return {
        explanation: { ...check.explanation, ...(traceId ? { traceId } : {}) },
        source: mode,
      };
    } catch (e) {
      const trace = (e as { traceId?: string | null }).traceId ?? traceId;
      return this.fallback(template, (e as Error).message, trace ?? undefined);
    }
  }

  private fallback(
    template: Explanation,
    reason: string,
    traceId?: string,
  ): ExplainOutcome {
    this.logger.warn(
      JSON.stringify({
        event: 'review_explanation_fallback',
        reason: reason.slice(0, 300),
        ...(traceId ? { trace_id: traceId } : {}),
      }),
    );
    return {
      explanation: {
        ...template,
        fallbackReason: reason.slice(0, 300),
        ...(traceId ? { traceId } : {}),
      },
      source: 'template',
    };
  }

  private async viaGemini(
    orgId: string,
    evidence: ReviewAnalystInput,
  ): Promise<unknown> {
    const res = await this.ai.generate(orgId, 'review-explain', {
      system: REVIEW_ANALYST_INSTRUCTION,
      messages: [{ role: 'user', content: JSON.stringify(evidence) }],
      jsonSchema: geminiSchema(),
      promptVersion: REVIEW_PROMPT_VERSION,
      task: 'review_explain',
    });
    return JSON.parse(res.text);
  }
}
