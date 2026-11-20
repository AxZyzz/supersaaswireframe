import { Injectable, Logger } from '@nestjs/common';
import { AiService } from '../ai/ai.service';

/**
 * Learning Loop T11: drafts challenger subject lines for the next test.
 *
 * Code decides, AI drafts, people approve: the output here is only a list of
 * suggestions that a person previews and approves. The AI is given the winning
 * subject and the offer name only (never lead data), its JSON is validated
 * against a schema, and anything invalid is replaced by deterministic
 * templates so the drawer always has candidates.
 *
 * T09 (ADK Copywriter agent) can replace AiChallengerDrafter by providing the
 * CHALLENGER_DRAFTER token; callers depend only on this interface.
 */
export const CHALLENGER_DRAFTER = Symbol('CHALLENGER_DRAFTER');

export interface ChallengerDraftInput {
  orgId: string;
  /** The subject currently winning (or the control when nothing won). */
  baseSubject: string;
  /** Subjects already in use; a draft must differ from all of them. */
  avoid: string[];
  offerName: string | null;
  offerDescription: string | null;
}

export interface ChallengerCandidate {
  subject: string;
  source: 'template' | 'gemini' | 'mock';
}

export interface ChallengerDrafter {
  draft(input: ChallengerDraftInput): Promise<ChallengerCandidate[]>;
}

export const CANDIDATE_COUNT = 3;
export const MAX_SUBJECT_LEN = 120;

export const CHALLENGER_PROMPT_VERSION = 'challenger-subjects@1';

export const CHALLENGER_SCHEMA = {
  type: 'object',
  properties: {
    subjects: { type: 'array', items: { type: 'string' } },
  },
  required: ['subjects'],
};

/** One clean line: no control characters, collapsed spaces, capped length. */
export function cleanSubject(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  // control characters (tabs, newlines, NUL...) become spaces
  let s = '';
  for (const ch of raw) {
    const code = ch.charCodeAt(0);
    s += code < 32 || code === 127 ? ' ' : ch;
  }
  s = s.replace(/\s+/g, ' ').trim();
  if (!s || s.length > MAX_SUBJECT_LEN) return null;
  return s;
}

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();

/**
 * Keeps valid, distinct subjects that are not in `avoid` (case-insensitive).
 * Placeholders like {first_name} are allowed: the send pipeline renders them.
 */
export function validateSubjects(raw: unknown, avoid: string[]): string[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set(avoid.map(norm));
  const out: string[] = [];
  for (const item of raw) {
    const s = cleanSubject(item);
    if (!s) continue;
    if (seen.has(norm(s))) continue;
    seen.add(norm(s));
    out.push(s);
  }
  return out;
}

/** Deterministic fallbacks built from the base subject: no AI, no surprises. */
export function templateSubjects(
  baseSubject: string,
  offerName: string | null,
): string[] {
  const base = cleanSubject(baseSubject) ?? 'your outreach';
  const topic = base.replace(/[?.!]+$/, '');
  const offer = offerName?.trim() || null;
  const list = [
    `Quick question: ${topic.charAt(0).toLowerCase()}${topic.slice(1)}?`,
    offer
      ? `${offer}, for {company|your team}`
      : `An idea for {company|your team}`,
    topic.length > 40 ? topic.slice(0, 38).trimEnd() + '…' : `Re: ${topic}`,
    `Is this on your radar, {first_name|there}?`,
    `Two minutes on ${offer ?? 'something that could help'}?`,
  ];
  return list;
}

/** Merge AI picks with template fallbacks until there are `CANDIDATE_COUNT`. */
export function completeCandidates(
  aiSubjects: string[],
  input: Pick<ChallengerDraftInput, 'baseSubject' | 'avoid' | 'offerName'>,
  aiSource: 'gemini' | 'mock',
): ChallengerCandidate[] {
  const picked: ChallengerCandidate[] = aiSubjects
    .slice(0, CANDIDATE_COUNT)
    .map((subject) => ({ subject, source: aiSource }));
  if (picked.length >= CANDIDATE_COUNT) return picked;
  const taken = [...input.avoid, ...picked.map((p) => p.subject)];
  const fill = validateSubjects(
    templateSubjects(input.baseSubject, input.offerName),
    taken,
  );
  for (const subject of fill) {
    if (picked.length >= CANDIDATE_COUNT) break;
    picked.push({ subject, source: 'template' });
  }
  return picked;
}

@Injectable()
export class AiChallengerDrafter implements ChallengerDrafter {
  private readonly logger = new Logger(AiChallengerDrafter.name);

  constructor(private readonly ai: AiService) {}

  async draft(input: ChallengerDraftInput): Promise<ChallengerCandidate[]> {
    const provider = this.ai.providerName();
    const aiSource = provider === 'mock' ? 'mock' : 'gemini';
    let aiSubjects: string[] = [];
    try {
      const result = await this.ai.generate(input.orgId, 'challenger-draft', {
        system: [
          'You write email subject lines for B2B cold outreach tests.',
          'Write short, plain, honest subject lines. No clickbait, no ALL CAPS,',
          'no emojis, no false urgency. Each must be under 80 characters.',
          'Each must be clearly different in angle from the base subject.',
          'You may use these tokens: {first_name|there}, {company|your team}.',
          `Return exactly ${CANDIDATE_COUNT} subject lines.`,
        ].join(' '),
        messages: [
          {
            role: 'user',
            content: [
              `Base subject (currently winning): ${input.baseSubject}`,
              input.offerName ? `Offer: ${input.offerName}` : null,
              input.offerDescription
                ? `Offer description: ${input.offerDescription.slice(0, 500)}`
                : null,
              input.avoid.length
                ? `Do not repeat these: ${input.avoid.join(' | ')}`
                : null,
            ]
              .filter(Boolean)
              .join('\n'),
          },
        ],
        tier: 'fast',
        maxTokens: 400,
        jsonSchema: CHALLENGER_SCHEMA,
        promptVersion: CHALLENGER_PROMPT_VERSION,
      });
      const parsed = JSON.parse(result.text) as { subjects?: unknown };
      aiSubjects = validateSubjects(parsed.subjects, input.avoid);
    } catch (e) {
      // invalid JSON, provider down, quota: fall back to templates below
      this.logger.warn(
        `Challenger AI draft failed, using templates: ${(e as Error).message}`,
      );
    }
    return completeCandidates(aiSubjects, input, aiSource);
  }
}
