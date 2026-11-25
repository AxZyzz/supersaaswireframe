/**
 * Fixed value lists for lead / Discover attributes. Mirror of
 * packages/shared/src/attributes.ts (the API image doesn't ship the shared
 * package); attributes.spec.ts fails if they drift.
 */
export const INDUSTRIES = [
  'saas',
  'it_services',
  'agency_marketing',
  'ecommerce',
  'healthcare_clinic',
  'education',
  'real_estate',
  'finance',
  'manufacturing',
  'logistics',
  'hospitality',
  'professional_services',
  'retail_local',
  'nonprofit',
  'other',
  'unknown',
] as const;
export type Industry = (typeof INDUSTRIES)[number];

export const SIZE_BANDS = [
  '1-10',
  '11-50',
  '51-200',
  '201-1000',
  '1000+',
  'unknown',
] as const;
export type SizeBand = (typeof SIZE_BANDS)[number];

/** Buying triggers (Aman's decision #8). "None found" = an empty list. */
export const TRIGGER_TYPES = [
  'hiring',
  'expansion',
  'funding',
  'product_launch',
] as const;
export type TriggerType = (typeof TRIGGER_TYPES)[number];

export interface Trigger {
  type: TriggerType;
  quote: string;
  url: string;
  observed_at: string | null;
}

export const MAIL_PROVIDERS = [
  'google',
  'microsoft',
  'zoho',
  'other',
  'unknown',
] as const;
export type MailProvider = (typeof MAIL_PROVIDERS)[number];
