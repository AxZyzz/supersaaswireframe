import type { ArmCounts, ReviewInput } from '../types';

/** A clean, mature, healthy arm: 1000 companies, 3% bounce, nothing waiting. */
export const arm = (over: Partial<ArmCounts> = {}): ArmCounts => ({
  variantId: 'v-a',
  label: 'A',
  isControl: true,
  assigned: 1000,
  sent: 1000,
  delivered: 980,
  bounced: 20,
  opened: 300,
  replied: 40,
  qualifiedVerified: 20,
  qualifiedProvisional: 0,
  booked: 5,
  unsubscribed: 3,
  complaints: 0,
  windowClosed: 1000,
  ...over,
});

export const armB = (over: Partial<ArmCounts> = {}): ArmCounts =>
  arm({
    variantId: 'v-b',
    label: 'B',
    isControl: false,
    qualifiedVerified: 60,
    ...over,
  });

/** All gates pass, control 2% vs challenger 6%: a clear challenger win. */
export const input = (over: Partial<ReviewInput> = {}): ReviewInput => ({
  experimentId: 'exp-1',
  policyVersion: 'review-policy/1',
  now: new Date('2026-12-15T00:00:00Z'),
  decisionDate: new Date('2026-12-01T00:00:00Z'),
  earliestFullRead: new Date('2026-12-01T00:00:00Z'),
  baselineRate: 0.03,
  minLiftPp: 2,
  targetNPerArm: 800,
  guardrails: { bounce: 0.05, unsub: 0.02, complaint: 0.003 },
  coverageGate: 0.9,
  outcomeCoverage: 1,
  arms: [arm(), armB()],
  flags: {
    unattributedReplies: 0,
    ambiguousAttribution: 0,
    variantEditedWhileRunning: false,
  },
  simulated: false,
  ...over,
});
