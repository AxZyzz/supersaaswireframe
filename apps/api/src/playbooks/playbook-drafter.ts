import { Injectable, Logger } from '@nestjs/common';
import { unsupportedNumber } from '../agents/explanation-validator';
import { AiService } from '../ai/ai.service';
import type { ArmReport, Finding, LiftReport } from '../review/policy/types';
import {
  DEFAULT_VALID_DAYS,
  MAX_BODY,
  MAX_TITLE,
  MIN_BODY,
  MIN_TITLE,
  type PlaybookDraft,
  type PlaybookEvidence,
  type PlaybookSegment,
} from './playbook.types';

/**
 * Drafts the text of a playbook (Learning Loop T14).
 *
 * Code decides, AI drafts, people approve:
 *  - the TEMPLATE text is written by code from the review's own numbers;
 *  - an optional AI rewording is kept only if every number in it is one the
 *    evidence supports, it stays inside the length limits and (for audience
 *    playbooks, which are exploratory) it claims no cause or proof. Anything
 *    else falls back to the template;
 *  - the evidence stored with the playbook is always the code-built one;
 *  - nothing is saved until a manager edits and saves it.
 * The AI sees aggregate numbers and a subject line, never lead data.
 */

const pct = (x: number) => (x * 100).toFixed(1);
const pts = (x: number) => (Math.abs(x) * 100).toFixed(1);
const clip = (s: string, n: number) =>
  s.length <= n ? s : `${s.slice(0, n - 1).trimEnd()}…`;

export interface ReviewDraftInput {
  offerId: string;
  offerName: string;
  reviewId: string;
  revision: number;
  experimentId: string;
  decision: string;
  winner: ArmReport;
  control: ArmReport;
  lift: LiftReport;
  winnerSubject: string;
  findings: Finding[];
  computedAt: string;
}

export interface PreferenceDraftInput {
  offerId: string;
  preferenceId: string;
  segment: PlaybookSegment;
  label: string;
  metric: string;
  x: number;
  n: number;
  p: number;
  lo: number;
  hi: number;
  overallP: number;
  confounding: string | null;
  computedAt: string;
}

type Built = Omit<PlaybookDraft, 'source'>;

/** The message playbook: a promoted subject version, in plain words. */
export function buildReviewDraft(i: ReviewDraftInput): Built {
  const wn = i.winner.assigned;
  const cn = i.control.assigned;
  const numbers: PlaybookEvidence['numbers'] = {
    winnerRatePct: Number(pct(i.winner.qualifiedRate ?? 0)),
    controlRatePct: Number(pct(i.control.qualifiedRate ?? 0)),
    winnerQualified: i.winner.qualifiedVerified,
    controlQualified: i.control.qualifiedVerified,
    winnerCompanies: wn,
    controlCompanies: cn,
    liftPoints: Number(pts(i.lift.d)),
    liftLowPoints: Number(pts(i.lift.lo)),
    liftHighPoints: Number(pts(i.lift.hi)),
    confidenceLevel: 95,
  };
  const body =
    `Version ${i.winner.label} beat the control in confirmed qualified replies: ` +
    `${numbers.winnerRatePct}% vs ${numbers.controlRatePct}% ` +
    `(${i.winner.qualifiedVerified} of ${wn} and ${i.control.qualifiedVerified} of ${cn} companies), ` +
    `a lift of ${numbers.liftPoints} points with a 95% range of ${numbers.liftLowPoints} to ${numbers.liftHighPoints} points. ` +
    `Winning subject: "${i.winnerSubject}".`;
  return {
    offerId: i.offerId,
    kind: 'message',
    segment: null,
    title: clip(`Winning subject for ${i.offerName}`, MAX_TITLE),
    body: clip(body, MAX_BODY),
    validDays: DEFAULT_VALID_DAYS,
    evidence: {
      source: 'review',
      reviewId: i.reviewId,
      revision: i.revision,
      experimentId: i.experimentId,
      decision: i.decision,
      findingIds: i.findings
        .filter((f) => f.kind === 'rate' || f.kind === 'lift')
        .map((f) => f.id),
      numbers,
      subject: i.winnerSubject,
      context: [i.offerName],
      computedAt: i.computedAt,
    },
  };
}

/** The audience playbook: a segment that replied better. Exploratory, so it says "looked", never "proved". */
export function buildPreferenceDraft(i: PreferenceDraftInput): Built {
  const numbers: PlaybookEvidence['numbers'] = {
    ratePct: Number(pct(i.p)),
    overallRatePct: Number(pct(i.overallP)),
    companies: i.n,
    withOutcome: i.x,
    rangeLowPct: Number(pct(i.lo)),
    rangeHighPct: Number(pct(i.hi)),
  };
  const body =
    `Companies in this segment (${i.label}) had a ${numbers.ratePct}% rate of ${i.metric.replace(/_/g, ' ')} ` +
    `(${i.x} of ${i.n}) against ${numbers.overallRatePct}% overall, with a range of ${numbers.rangeLowPct}% to ${numbers.rangeHighPct}%. ` +
    `This is an observation to keep testing, not proof.` +
    (i.confounding ? ` ${i.confounding}` : '');
  return {
    offerId: i.offerId,
    kind: 'audience',
    segment: i.segment,
    title: clip(`Find more: ${i.label}`, MAX_TITLE),
    body: clip(body, MAX_BODY),
    validDays: DEFAULT_VALID_DAYS,
    evidence: {
      source: 'preference',
      preferenceId: i.preferenceId,
      findingIds: [],
      numbers,
      context: [i.label, ...(i.confounding ? [i.confounding] : [])],
      computedAt: i.computedAt,
    },
  };
}

/** Words an exploratory (audience) playbook must not use. */
const OVERCLAIM =
  /\b(proved|proves|proven|proof that|significant(?:ly)?|caused|causes|because of|guaranteed)\b/i;

export type DraftCheck = { ok: true } | { ok: false; reason: string };

/**
 * The gate every AI wording must pass. Used for the AI rewrite, and the tests
 * run it over the code-built template too, so the two can never drift apart.
 */
export function checkDraftText(
  d: Pick<PlaybookDraft, 'title' | 'body' | 'kind' | 'evidence'>,
): DraftCheck {
  const title = d.title.trim();
  const body = d.body.trim();
  if (title.length < MIN_TITLE || title.length > MAX_TITLE) {
    return { ok: false, reason: 'title length' };
  }
  if (body.length < MIN_BODY || body.length > MAX_BODY) {
    return { ok: false, reason: 'body length' };
  }
  const bad = unsupportedNumber(
    `${title} ${body}`,
    [],
    [d.evidence.numbers, d.evidence.subject ?? '', d.evidence.context ?? []],
  );
  if (bad !== null) return { ok: false, reason: `unsupported number ${bad}` };
  if (d.kind === 'audience' && OVERCLAIM.test(`${title} ${body}`)) {
    return { ok: false, reason: 'claims proof or cause' };
  }
  return { ok: true };
}

const DRAFT_SCHEMA = {
  type: 'object',
  properties: { title: { type: 'string' }, body: { type: 'string' } },
  required: ['title', 'body'],
};
export const PLAYBOOK_PROMPT_VERSION = 'playbook-draft@1';

@Injectable()
export class PlaybookDrafter {
  private readonly logger = new Logger(PlaybookDrafter.name);

  constructor(private readonly ai: AiService) {}

  /** The template, optionally reworded by the AI when (and only when) the reworded text passes the gate. */
  async polish(orgId: string, base: Built): Promise<PlaybookDraft> {
    const template: PlaybookDraft = { ...base, source: 'template' };
    const provider = this.ai.providerName();
    try {
      const result = await this.ai.generate(orgId, 'playbook-draft', {
        system: [
          'You tidy the wording of a short lesson that a sales team learned from an A/B test or an audience observation.',
          'Use plain words. Use ONLY the facts and numbers you are given: do not add, round or invent any number.',
          'Keep the title under 100 characters and the body under 350 characters.',
          base.kind === 'audience'
            ? 'This is an observation, not proof: never say it proved, caused or guarantees anything.'
            : 'Do not name or describe any individual person or company.',
          'Return JSON {"title": string, "body": string}.',
        ].join(' '),
        messages: [
          {
            role: 'user',
            content: JSON.stringify({
              kind: base.kind,
              title: base.title,
              body: base.body,
              segment: base.segment,
            }),
          },
        ],
        tier: 'fast',
        maxTokens: 500,
        jsonSchema: DRAFT_SCHEMA,
        promptVersion: PLAYBOOK_PROMPT_VERSION,
        task: 'playbook_draft',
      });
      const parsed = JSON.parse(result.text) as {
        title?: unknown;
        body?: unknown;
      };
      if (typeof parsed.title !== 'string' || typeof parsed.body !== 'string') {
        return template;
      }
      const candidate: PlaybookDraft = {
        ...template,
        title: parsed.title.trim(),
        body: parsed.body.trim(),
        source: provider === 'mock' ? 'mock' : 'gemini',
      };
      const check = checkDraftText(candidate);
      if (!check.ok) {
        this.logger.warn(
          `playbook AI wording rejected (${check.reason}), using the template`,
        );
        return template;
      }
      return candidate;
    } catch (e) {
      this.logger.warn(
        `playbook AI wording failed, using the template: ${(e as Error).message}`,
      );
      return template;
    }
  }
}
