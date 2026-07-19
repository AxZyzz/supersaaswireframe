// @supersaas/shared — types shared between apps/api and apps/web.
// Grows with E1 (DTOs, enums). Keep runtime-free: types, enums, constants only.

export const ROLES = ['admin', 'manager', 'agent'] as const;
export type Role = (typeof ROLES)[number];

export const LEAD_STATUSES = [
  'new',
  'contacted',
  'replied',
  'interested',
  'converted',
  'lost',
] as const;
export type LeadStatus = (typeof LEAD_STATUSES)[number];

export const REPLY_CLASSIFICATIONS = [
  'interested',
  'not_interested',
  'question',
  'out_of_office',
  'wrong_person',
  'manual_review',
] as const;
export type ReplyClassification = (typeof REPLY_CLASSIFICATIONS)[number];

export const SENDER_PROVIDERS = ['ses', 'gmail', 'smtp'] as const;
export type SenderProvider = (typeof SENDER_PROVIDERS)[number];
