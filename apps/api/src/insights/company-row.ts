import { roleBucket } from '../campaigns/snapshot';
import {
  type FactorValues,
  type InsightCompany,
  unknownIfEmpty,
} from './aggregate-insights';

/**
 * One contacted company as a source returns it, before factor values are
 * worked out (Learning Loop T06/T07). Postgres and BigQuery both produce this
 * shape and both pass it through toInsightCompany(), so the two sources can
 * only differ in the facts they read, never in how those facts become factors.
 */
export interface CompanyRow {
  company_key: string;
  first_sent: Date;
  /** The enrollment snapshot (frozen factors), if the enrollment has one. */
  snap: Record<string, unknown> | null;
  /** Lead-level fallbacks for old enrollments with no snapshot. BigQuery has no leads table, so these are null there. */
  lead_city: string | null;
  lead_region: string | null;
  lead_country: string | null;
  lead_mail_provider: string | null;
  lead_source: string | null;
  lead_title: string | null;
  sender_email: string | null;
  /** The subject text used to measure length (Postgres: as sent; BigQuery: the template/variant text). */
  subject: string | null;
  template_subject: string | null;
  variant_label: string | null;
  bounced: boolean | null;
  opened: boolean;
  replied: boolean | null;
  positive: boolean | null;
  qualified: boolean | null;
  booked: boolean | null;
  unsubscribed: boolean | null;
  first_reply_at: Date | null;
  reply_step: number | null;
}

const MERGE_TOKEN = /\{\{[^}]+\}\}|\{[a-zA-Z_][\w.]*\}/;

const subjectLength = (s: string | null): string => {
  const n = (s ?? '').length;
  return n <= 30 ? 'up to 30' : n <= 50 ? '31-50' : '51+';
};

const snapText = (snap: Record<string, unknown> | null, key: string) =>
  snap && typeof snap[key] === 'string' ? snap[key] : '';

export function toInsightCompany(r: CompanyRow): InsightCompany {
  const snap = r.snap;
  const pick = (key: string, fallback: string | null) =>
    unknownIfEmpty(snapText(snap, key) || fallback);
  const stars =
    snap && typeof snap.stars === 'number' ? String(snap.stars) : 'not_scored';
  const factors: FactorValues = {
    country: pick('country', r.lead_country),
    region: pick('region', r.lead_region),
    city: pick('city', r.lead_city),
    industry: pick('industry', null),
    size_band: pick('size_band', null),
    trigger: pick('primary_trigger', null),
    role: unknownIfEmpty(
      snapText(snap, 'role_bucket') || roleBucket(r.lead_title),
    ),
    lead_source: pick('source', r.lead_source),
    stars,
    mail_provider: pick('mail_provider', r.lead_mail_provider),
    variant: r.variant_label ? `Version ${r.variant_label}` : 'no A/B test',
    sender: unknownIfEmpty(r.sender_email),
    subject_length: subjectLength(r.subject),
    personalised: MERGE_TOKEN.test(r.template_subject ?? '')
      ? 'personalised'
      : 'not personalised',
  };
  return {
    companyKey: r.company_key,
    firstSentAt: r.first_sent,
    recipientTz: snapText(snap, 'timezone') || null,
    bounced: !!r.bounced,
    opened: r.opened,
    replied: !!r.replied,
    positive: !!r.positive,
    qualified: !!r.qualified,
    booked: !!r.booked,
    unsubscribed: !!r.unsubscribed,
    hoursToFirstReply: r.first_reply_at
      ? (r.first_reply_at.getTime() - r.first_sent.getTime()) / 3_600_000
      : null,
    replyStep: r.reply_step,
    factors,
  };
}
