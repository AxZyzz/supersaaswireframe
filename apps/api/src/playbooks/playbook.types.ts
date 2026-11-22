/**
 * Playbook memory (Learning Loop T14): approved learnings that future Discover
 * runs and challenger drafts retrieve as HINTS ("treat as hints, not facts;
 * prefer the current evidence"). The text lives in Postgres; BigQuery holds
 * only the vectors.
 */

export const PLAYBOOK_KINDS = ['message', 'audience'] as const;
export type PlaybookKind = (typeof PLAYBOOK_KINDS)[number];

export const PLAYBOOK_STATUSES = ['active', 'retired', 'superseded'] as const;
export type PlaybookStatus = (typeof PLAYBOOK_STATUSES)[number];

export type VectorStatus = 'pending' | 'indexed' | 'failed';

/** A learning stays valid for 90 days unless the person picks another length. */
export const DEFAULT_VALID_DAYS = 90;
export const MAX_VALID_DAYS = 365;
/** How many playbooks a Discover run or a draft is given. */
export const DEFAULT_TOP_K = 3;
export const MAX_TITLE = 120;
export const MIN_TITLE = 3;
export const MAX_BODY = 500;
export const MIN_BODY = 10;

/** Which slice of the audience an audience playbook is about (a Discover factor). */
export interface PlaybookSegment {
  factor: string;
  value: string;
}

/**
 * What the learning stands on. Always built by code from the review or the
 * search preference, never typed by a person or an AI.
 */
export interface PlaybookEvidence {
  source: 'review' | 'preference';
  reviewId?: string;
  revision?: number;
  experimentId?: string;
  /** The campaign the test ran in (for the link back to its Review). */
  campaignId?: string;
  preferenceId?: string;
  decision?: string;
  /** Finding ids of the review the numbers come from (F1, F2, ...). */
  findingIds: string[];
  /** The numbers the draft text may quote. */
  numbers: Record<string, number | string | null>;
  /** The winning subject, for message playbooks (a string, so digits in it are allowed in the text). */
  subject?: string;
  /** Other words of the text that code (not a person or an AI) supplied: offer name, segment label, the Insights note. Digits in them are allowed. */
  context?: string[];
  computedAt: string;
}

export interface PlaybookView {
  id: string;
  offerId: string;
  offerName: string | null;
  kind: PlaybookKind;
  segment: PlaybookSegment | null;
  title: string;
  body: string;
  evidence: PlaybookEvidence;
  validFrom: Date;
  validTo: Date;
  version: number;
  supersedesId: string | null;
  status: PlaybookStatus;
  vectorStatus: VectorStatus;
  createdBy: { id: string; name: string } | null;
  createdAt: Date;
  retiredAt: Date | null;
  /** valid_to has passed (it is no longer retrieved). */
  expired: boolean;
}

/** What a prompt receives: no ids of people, no lead data. */
export interface PlaybookHint {
  id: string;
  title: string;
  body: string;
  /** ISO date. */
  validTo: string;
}

/** A prefilled playbook for a person to edit and save. */
export interface PlaybookDraft {
  offerId: string;
  kind: PlaybookKind;
  segment: PlaybookSegment | null;
  title: string;
  body: string;
  evidence: PlaybookEvidence;
  validDays: number;
  /** template = written by code from the evidence; gemini / mock = AI wording that passed the number check. */
  source: 'template' | 'gemini' | 'mock';
}

export const hintFrom = (p: {
  id: string;
  title: string;
  body: string;
  validTo: Date;
}): PlaybookHint => ({
  id: p.id,
  title: p.title,
  body: p.body,
  validTo: p.validTo.toISOString(),
});

/** One line for a prompt. The label tells the model how much to trust it. */
export const hintLine = (h: PlaybookHint): string =>
  `${h.title}: ${h.body} (approved learning, valid until ${h.validTo.slice(0, 10)})`;

export const HINT_PREAMBLE =
  'Prior approved learnings from this workspace. Treat them as hints, not facts. Prefer the current evidence.';

/** The text that is embedded: what the playbook says and who it is about. */
export function embeddingText(p: {
  title: string;
  body: string;
  segment: PlaybookSegment | null;
}): string {
  return [
    p.title,
    p.body,
    p.segment ? `Segment: ${p.segment.factor} ${p.segment.value}` : null,
  ]
    .filter(Boolean)
    .join('\n');
}
