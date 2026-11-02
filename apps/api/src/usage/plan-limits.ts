/**
 * Plan limits — the single source of truth for what a workspace may use.
 * Beta numbers mirror Spec → Finance → Rate Limits and the public pricing page
 * (apps/web/src/lib/marketing.ts BETA_LIMITS); keep the three in sync.
 * `null` = unlimited.
 */
export type Plan = 'beta' | 'internal';

export type Resource =
  | 'leads'
  | 'activeCampaigns'
  | 'stepsPerCampaign'
  | 'senders'
  | 'members'
  | 'emailsPerDay'
  | 'emailsPerMonth'
  | 'aiGenerationsPerMonth';

export type PlanLimits = Record<Resource, number | null>;

export const PLAN_LIMITS: Record<Plan, PlanLimits> = {
  beta: {
    leads: 2000,
    activeCampaigns: 5,
    stepsPerCampaign: 5,
    senders: 3,
    members: 3,
    emailsPerDay: 100,
    emailsPerMonth: 1000,
    aiGenerationsPerMonth: 30,
  },
  internal: {
    leads: null,
    activeCampaigns: null,
    stepsPerCampaign: null,
    senders: null,
    members: null,
    emailsPerDay: null,
    emailsPerMonth: null,
    aiGenerationsPerMonth: null,
  },
};

export const RESOURCE_LABELS: Record<Resource, string> = {
  leads: 'leads',
  activeCampaigns: 'active campaigns',
  stepsPerCampaign: 'steps per campaign',
  senders: 'sender accounts',
  members: 'team members (incl. pending invites)',
  emailsPerDay: 'emails per day',
  emailsPerMonth: 'emails per month',
  aiGenerationsPerMonth: 'AI sequence generations per month',
};

/** ai_usage.feature value that counts toward aiGenerationsPerMonth. */
export const AI_GENERATION_FEATURE = 'sequence-gen';
