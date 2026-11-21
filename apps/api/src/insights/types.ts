/**
 * Insights (Learning Loop T06): what works, factor by factor. Everything here
 * is an EXPLORATORY observation among contacted companies, never a decision.
 * The unit is the company (company_key): two contacts at one company are one.
 */

export type FactorGroup = 'audience' | 'send' | 'sequence';

export interface FactorDef {
  id: FactorId;
  label: string;
  group: FactorGroup;
  /** Discover can search for it (so "Test next batch" applies once T12 lands). */
  searchable: boolean;
  /** Shows the discovered -> eligible -> reached ... funnel. */
  funnel: boolean;
  /** 'distribution' = counts only (no per-company rate makes sense). */
  kind: 'rate' | 'distribution';
}

export const FACTOR_IDS = [
  'country',
  'region',
  'city',
  'industry',
  'size_band',
  'trigger',
  'role',
  'lead_source',
  'stars',
  'mail_provider',
  'send_day',
  'send_hour',
  'sequence_step',
  'variant',
  'sender',
  'subject_length',
  'personalised',
] as const;
export type FactorId = (typeof FACTOR_IDS)[number];

export const FACTORS: FactorDef[] = [
  {
    id: 'country',
    label: 'Country',
    group: 'audience',
    searchable: true,
    funnel: true,
    kind: 'rate',
  },
  {
    id: 'region',
    label: 'State / region',
    group: 'audience',
    searchable: true,
    funnel: true,
    kind: 'rate',
  },
  {
    id: 'city',
    label: 'City',
    group: 'audience',
    searchable: true,
    funnel: true,
    kind: 'rate',
  },
  {
    id: 'industry',
    label: 'Industry',
    group: 'audience',
    searchable: true,
    funnel: true,
    kind: 'rate',
  },
  {
    id: 'size_band',
    label: 'Company size',
    group: 'audience',
    searchable: true,
    funnel: true,
    kind: 'rate',
  },
  {
    id: 'trigger',
    label: 'Buying trigger',
    group: 'audience',
    searchable: true,
    funnel: true,
    kind: 'rate',
  },
  {
    id: 'role',
    label: 'Contact role',
    group: 'audience',
    searchable: false,
    funnel: false,
    kind: 'rate',
  },
  {
    id: 'lead_source',
    label: 'Lead source',
    group: 'audience',
    searchable: false,
    funnel: false,
    kind: 'rate',
  },
  {
    id: 'stars',
    label: 'Fit score (stars)',
    group: 'audience',
    searchable: false,
    funnel: false,
    kind: 'rate',
  },
  {
    id: 'mail_provider',
    label: 'Recipient mail provider',
    group: 'audience',
    searchable: false,
    funnel: false,
    kind: 'rate',
  },
  {
    id: 'send_day',
    label: 'Send day of week',
    group: 'send',
    searchable: false,
    funnel: false,
    kind: 'rate',
  },
  {
    id: 'send_hour',
    label: 'Send hour',
    group: 'send',
    searchable: false,
    funnel: false,
    kind: 'rate',
  },
  {
    id: 'sequence_step',
    label: 'Sequence step of the reply',
    group: 'sequence',
    searchable: false,
    funnel: false,
    kind: 'distribution',
  },
  {
    id: 'variant',
    label: 'Subject version (A/B test)',
    group: 'sequence',
    searchable: false,
    funnel: false,
    kind: 'rate',
  },
  {
    id: 'sender',
    label: 'Sender mailbox',
    group: 'sequence',
    searchable: false,
    funnel: false,
    kind: 'rate',
  },
  {
    id: 'subject_length',
    label: 'Subject length',
    group: 'sequence',
    searchable: false,
    funnel: false,
    kind: 'rate',
  },
  {
    id: 'personalised',
    label: 'Personalised subject',
    group: 'sequence',
    searchable: false,
    funnel: false,
    kind: 'rate',
  },
];

export const FACTOR_BY_ID = new Map(FACTORS.map((f) => [f.id, f]));

export const METRICS = [
  'reply',
  'positive',
  'qualified',
  'booked',
  'open',
] as const;
export type Metric = (typeof METRICS)[number];

/** Factors whose buckets can have a "dominant other value" (the confounding hint). */
export type MixFactor = 'trigger' | 'industry' | 'city';
export interface Dominant {
  value: string;
  /** Share of this bucket's reached companies with that value, 0..1. */
  share: number;
  /** Share of ALL reached companies with that value, 0..1. */
  overallShare: number;
}

/**
 * One bucket of one factor. Same shape for every InsightsSource (Postgres now,
 * BigQuery in T07). Counts are companies.
 */
export interface BucketRow {
  factor: FactorId;
  bucket: string;
  /** Companies with at least one first-touch email sent. */
  sent: number;
  /** ...and not bounced: the unit for every rate below. */
  reached: number;
  bounced: number;
  /** Real (non-bot) opens: a diagnostic. */
  opened: number;
  replied: number;
  /** AI-classified interested (provisional or verified). */
  positive: number;
  /** Human-verified qualified: the strongest signal. */
  qualified: number;
  booked: number;
  unsubscribed: number;
  /** Median hours from first send to first reply, null if no replies. */
  medianHoursToReply: number | null;
  /** Funnel: Discover prospects in this bucket (factors 1-6 only). */
  discovered: number;
  /** ...with a real, mail-accepting email address. */
  eligible: number;
  /** For the confounding hint: what else is true of this bucket's companies. */
  dominant?: Partial<Record<MixFactor, Dominant>>;
}

/** One cell of the send-time heatmap (day x 2-hour block, recipient time when known). */
export interface GridRow {
  /** 0 = Monday ... 6 = Sunday */
  day: number;
  /** 0 = 6-8, 1 = 8-10, ... 7 = 20-22 */
  block: number;
  reached: number;
  replied: number;
  qualified: number;
}

export interface InsightsQuery {
  orgId: string;
  offerId?: string;
  campaignIds?: string[];
  from?: Date;
  to?: Date;
}

export interface InsightsData {
  buckets: Record<FactorId, BucketRow[]>;
  grid: GridRow[];
  /** Where send times came from: recipient timezone vs the workspace timezone. */
  timezone: { recipient: number; workspace: number; workspaceZone: string };
  /** Distinct 2-hour blocks that first-touch emails were sent in. */
  sendBlocksUsed: number[];
  /** Overall counts for the scope. */
  totals: Omit<BucketRow, 'factor' | 'bucket' | 'dominant'>;
}

/** Where insight numbers come from. Postgres now; BigQuery in T07 returns the same rows. */
export interface InsightsSource {
  readonly name: string;
  factorFunnel(q: InsightsQuery, factor: FactorId): Promise<BucketRow[]>;
  sendTimeGrid(q: InsightsQuery): Promise<GridRow[]>;
  /** Everything in one pass (cheaper than calling the two above for every factor). */
  all(q: InsightsQuery): Promise<InsightsData>;
}
