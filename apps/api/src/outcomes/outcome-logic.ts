/**
 * Pure rules for outcome events (Learning Loop T03). No database here, so the
 * rules are easy to test and T04's review maths can reuse them.
 */

export const OUTCOME_TYPES = [
  'qualified_reply',
  'booked_call',
  'reply',
  'bounce',
  'unsubscribe',
  'complaint',
] as const;
export type OutcomeType = (typeof OUTCOME_TYPES)[number];

export const OUTCOME_SOURCES = [
  'inbox_ai',
  'manual',
  'gmail_sync',
  'system',
  'crm',
  'calendar',
] as const;
export type OutcomeSource = (typeof OUTCOME_SOURCES)[number];

export const VERIFICATIONS = ['provisional', 'verified', 'rejected'] as const;
export type Verification = (typeof VERIFICATIONS)[number];

/** Types a person can confirm / reject (the others are facts, not judgements). */
export const VERIFIABLE_TYPES: readonly OutcomeType[] = [
  'qualified_reply',
  'booked_call',
];

/** Idempotency keys: the same real-world event always maps to the same key. */
export const keys = {
  reply: (messageRef: string) => `reply:${messageRef}`,
  qualified: (conversationId: string) => `qr:${conversationId}`,
  bounce: (sentEmailId: string) => `bounce:${sentEmailId}`,
  unsubscribe: (campaignLeadId: string) => `unsubscribe:${campaignLeadId}`,
  complaint: (sentEmailId: string) => `complaint:${sentEmailId}`,
  verify: (outcomeId: string) => `verify:${outcomeId}`,
  manual: (clientKey: string) => `manual:${clientKey}`,
};

/**
 * Outcome coverage (the T04 gate): the share of replying companies whose
 * outcome is settled. A replying company is settled when no AI "qualified"
 * label is still waiting for a person (the AI didn't flag it, or a person
 * verified / rejected it). 1 when nobody has replied yet, since nothing is
 * waiting for a decision.
 */
export function outcomeCoverage(counts: {
  replyingCompanies: number;
  settledCompanies: number;
}): number {
  const { replyingCompanies, settledCompanies } = counts;
  if (replyingCompanies <= 0) return 1;
  return Math.min(1, Math.max(0, settledCompanies / replyingCompanies));
}

/** A correction of a decision already made must say why. */
export function reasonRequired(current: Verification): boolean {
  return current !== 'provisional';
}
