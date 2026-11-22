import { api } from './api';

/** Learning Loop T14: approved learnings the next Discover run and challenger draft can use as hints. */

export type PlaybookKind = 'message' | 'audience';
export type PlaybookStatus = 'active' | 'retired' | 'superseded';

export interface PlaybookEvidence {
  source: 'review' | 'preference';
  reviewId?: string;
  revision?: number;
  experimentId?: string;
  campaignId?: string;
  preferenceId?: string;
  decision?: string;
  findingIds: string[];
  numbers: Record<string, number | string | null>;
  subject?: string;
  computedAt: string;
}

export interface Playbook {
  id: string;
  offerId: string;
  offerName: string | null;
  kind: PlaybookKind;
  segment: { factor: string; value: string } | null;
  title: string;
  body: string;
  evidence: PlaybookEvidence;
  validFrom: string;
  validTo: string;
  version: number;
  supersedesId: string | null;
  status: PlaybookStatus;
  vectorStatus: 'pending' | 'indexed' | 'failed';
  createdBy: { id: string; name: string } | null;
  createdAt: string;
  retiredAt: string | null;
  expired: boolean;
}

/** A prefilled "Save as playbook": nothing is saved until a person edits and saves it. */
export interface PlaybookDraft {
  offerId: string;
  kind: PlaybookKind;
  segment: { factor: string; value: string } | null;
  title: string;
  body: string;
  evidence: PlaybookEvidence;
  validDays: number;
  source: 'template' | 'gemini' | 'mock';
}

/** Which approved result a draft or a playbook comes from: exactly one. */
export type PlaybookSource = { reviewId: string } | { preferenceId: string };

const send = <T>(method: string, path: string, body?: unknown) =>
  api<T>(path, {
    method,
    body: body === undefined ? undefined : JSON.stringify(body),
  });

export const listPlaybooks = (offerId?: string) =>
  api<Playbook[]>(`/playbooks${offerId ? `?offerId=${offerId}` : ''}`);

export const playbookVersions = (id: string) =>
  api<Playbook[]>(`/playbooks/${id}/versions`);

export const draftPlaybook = (source: PlaybookSource) =>
  send<PlaybookDraft>('POST', '/playbooks/draft', source);

export const createPlaybook = (
  source: PlaybookSource,
  body: { title: string; body: string; validDays?: number },
) => send<Playbook>('POST', '/playbooks', { ...source, ...body });

export const editPlaybook = (
  id: string,
  body: { title: string; body: string; validDays?: number },
) => send<Playbook>('PATCH', `/playbooks/${id}`, body);

export const retirePlaybook = (id: string) =>
  send<Playbook>('POST', `/playbooks/${id}/retire`);

export const reindexPlaybooks = () =>
  send<{ indexed: number; failed: number; skipped: boolean }>(
    'POST',
    '/playbooks/reindex',
  );

export const VALIDITY_CHOICES = [
  { days: 30, label: '30 days' },
  { days: 60, label: '60 days' },
  { days: 90, label: '90 days (default)' },
  { days: 180, label: '6 months' },
  { days: 365, label: '1 year' },
];

/** "Valid until 20 Feb 2027", or how long ago it ran out. */
export function validityText(
  p: Pick<Playbook, 'validTo' | 'expired' | 'status'>,
): string {
  const to = new Date(p.validTo);
  const date = to.toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
  if (p.status === 'retired') return 'Retired';
  if (p.status === 'superseded') return 'Replaced by a newer version';
  if (p.expired) return `Expired ${date}`;
  const days = Math.max(0, Math.ceil((to.getTime() - Date.now()) / 86_400_000));
  return `Valid until ${date} (${days} day${days === 1 ? '' : 's'} left)`;
}

export const KIND_LABEL: Record<PlaybookKind, string> = {
  message: 'Message',
  audience: 'Audience',
};
