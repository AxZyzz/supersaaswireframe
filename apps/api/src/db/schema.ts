import { sql } from 'drizzle-orm';
import {
  pgTable,
  pgEnum,
  uuid,
  text,
  timestamp,
  uniqueIndex,
  index,
  jsonb,
  primaryKey,
  integer,
  boolean,
  real,
} from 'drizzle-orm/pg-core';

// Tenant model: users are global (one login, many orgs); everything org-scoped
// carries org_id and is guarded by RLS (see the rls migration).

export const roleEnum = pgEnum('role', ['admin', 'manager', 'agent']);

export const orgs = pgTable('orgs', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  slug: text('slug').notNull().unique(),
  website: text('website'),
  industry: text('industry'),
  teamSize: text('team_size'),
  timezone: text('timezone').notNull().default('UTC'),
  // Branding (E9 / white-label readiness): accent hex + small logo data URL.
  brandColor: text('brand_color'),
  // T2.3: ordered {name,color}[] lead status list; NULL = system defaults.
  leadStatuses: jsonb('lead_statuses'),
  logoData: text('logo_data'),
  onboardedAt: timestamp('onboarded_at', { withTimezone: true }),
  // Usage plan; limits per plan live in src/usage/plan-limits.ts.
  plan: text('plan').notNull().default('beta'),
  // CAN-SPAM postal address, printed in every campaign email footer.
  postalAddress: text('postal_address'),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    email: text('email').notNull(),
    passwordHash: text('password_hash').notNull(),
    name: text('name').notNull(),
    // A2B staff with access to the cross-tenant operator console (T8.6).
    // Granted only via `npm run operator:grant`, never through the API.
    isOperator: boolean('is_operator').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  // Case-insensitive unique email. NOTE: drizzle-kit can't introspect
  // expression indexes, so `generate` re-emits an identical DROP/CREATE as
  // false drift — migrations 0000..0004 are the source of truth, ignore it.
  (t) => [uniqueIndex('users_email_lower_idx').on(sql`lower(${t.email})`)],
);

export const memberships = pgTable(
  'memberships',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => orgs.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: roleEnum('role').notNull().default('agent'),
    // notification types this member muted in this workspace (0035)
    mutedNotifications: text('muted_notifications')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex('memberships_org_user_idx').on(t.orgId, t.userId),
    index('memberships_org_idx').on(t.orgId),
    index('memberships_user_idx').on(t.userId),
  ],
);

// Team invites (E9). Link carries a random token; only its sha256 is stored.
// One pending invite per (org, lower(email)) — see 0031 partial index.
export const invites = pgTable(
  'invites',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => orgs.id, { onDelete: 'cascade' }),
    email: text('email').notNull(),
    role: roleEnum('role').notNull().default('agent'),
    tokenHash: text('token_hash').notNull(),
    invitedBy: uuid('invited_by').references(() => users.id, {
      onDelete: 'set null',
    }),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    acceptedAt: timestamp('accepted_at', { withTimezone: true }),
    acceptedBy: uuid('accepted_by').references(() => users.id, {
      onDelete: 'set null',
    }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex('invites_token_hash_idx').on(t.tokenHash),
    index('invites_org_idx').on(t.orgId),
  ],
);

export const refreshTokens = pgTable(
  'refresh_tokens',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index('refresh_tokens_user_idx').on(t.userId)],
);

// ── E2: Lead management ──────────────────────────────────────────────────
// All tables carry org_id + RLS. Status is free text (default set +
// user-defined) so kanban can group by it without a status table; score is a
// fixed enum. Custom fields live in a jsonb bag.

export const leadScoreEnum = pgEnum('lead_score', ['hot', 'warm', 'cold']);

export const leads = pgTable(
  'leads',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => orgs.id, { onDelete: 'cascade' }),
    email: text('email'),
    firstName: text('first_name'),
    lastName: text('last_name'),
    company: text('company'),
    title: text('title'),
    phone: text('phone'),
    status: text('status').notNull().default('new'),
    score: leadScoreEnum('score'),
    source: text('source'),
    custom: jsonb('custom')
      .notNull()
      .default(sql`'{}'::jsonb`),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index('leads_org_idx').on(t.orgId),
    index('leads_org_status_idx').on(t.orgId, t.status),
    index('leads_org_created_idx').on(t.orgId, t.createdAt),
    // Dedupe key: one lead per email per org (case-insensitive), NULL emails
    // allowed and never collide (partial index).
    uniqueIndex('leads_org_email_idx')
      .on(t.orgId, sql`lower(${t.email})`)
      .where(sql`${t.email} IS NOT NULL`),
  ],
);

export const tags = pgTable(
  'tags',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => orgs.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    color: text('color').notNull().default('#666666'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [uniqueIndex('tags_org_name_idx').on(t.orgId, sql`lower(${t.name})`)],
);

export const leadTags = pgTable(
  'lead_tags',
  {
    orgId: uuid('org_id')
      .notNull()
      .references(() => orgs.id, { onDelete: 'cascade' }),
    leadId: uuid('lead_id')
      .notNull()
      .references(() => leads.id, { onDelete: 'cascade' }),
    tagId: uuid('tag_id')
      .notNull()
      .references(() => tags.id, { onDelete: 'cascade' }),
  },
  (t) => [
    primaryKey({ columns: [t.leadId, t.tagId] }),
    index('lead_tags_org_idx').on(t.orgId),
    index('lead_tags_tag_idx').on(t.tagId),
  ],
);

export const leadNotes = pgTable(
  'lead_notes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => orgs.id, { onDelete: 'cascade' }),
    leadId: uuid('lead_id')
      .notNull()
      .references(() => leads.id, { onDelete: 'cascade' }),
    authorUserId: uuid('author_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    body: text('body').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index('lead_notes_lead_idx').on(t.leadId)],
);

// Segments. 'manual' = explicit membership (segment_members rows added by
// hand). 'smart' = a rule set evaluated to materialize membership on refresh.
// A tag-based segment is just a smart segment with one has-tag rule.
export const segments = pgTable(
  'segments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => orgs.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    type: text('type').notNull().default('smart'),
    rules: jsonb('rules')
      .notNull()
      .default(sql`'{}'::jsonb`),
    memberCount: integer('member_count').notNull().default(0),
    lastRefreshedAt: timestamp('last_refreshed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex('segments_org_name_idx').on(t.orgId, sql`lower(${t.name})`),
  ],
);

// Materialized segment membership (recomputed for smart segments on refresh,
// maintained by hand for manual segments).
export const segmentMembers = pgTable(
  'segment_members',
  {
    orgId: uuid('org_id')
      .notNull()
      .references(() => orgs.id, { onDelete: 'cascade' }),
    segmentId: uuid('segment_id')
      .notNull()
      .references(() => segments.id, { onDelete: 'cascade' }),
    leadId: uuid('lead_id')
      .notNull()
      .references(() => leads.id, { onDelete: 'cascade' }),
  },
  (t) => [
    primaryKey({ columns: [t.segmentId, t.leadId] }),
    index('segment_members_lead_idx').on(t.leadId),
    index('segment_members_org_idx').on(t.orgId),
  ],
);

// ── E3: Sender accounts ──────────────────────────────────────────────────
// A sending identity. provider = ses | gmail | smtp. Secrets (OAuth tokens,
// SMTP passwords) go in `config` AES-256-encrypted once real sending lands
// (E3 wiring); for now this is config + verification status. Daily limit and
// optional send window feed the E5 sending engine.
export const senderProviderEnum = pgEnum('sender_provider', [
  'ses',
  'gmail',
  'smtp',
]);

export const senderAccounts = pgTable(
  'sender_accounts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => orgs.id, { onDelete: 'cascade' }),
    provider: senderProviderEnum('provider').notNull(),
    fromName: text('from_name').notNull(),
    fromEmail: text('from_email').notNull(),
    replyTo: text('reply_to'),
    signature: text('signature'),
    dailyLimit: integer('daily_limit').notNull().default(50),
    sendWindowStart: integer('send_window_start'),
    sendWindowEnd: integer('send_window_end'),
    // Warm-up ramp (T5.2): caps daily volume over the first 30 days.
    warmupEnabled: boolean('warmup_enabled').notNull().default(true),
    warmupStartedAt: timestamp('warmup_started_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    status: text('status').notNull().default('unverified'),
    config: jsonb('config')
      .notNull()
      .default(sql`'{}'::jsonb`),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index('sender_accounts_org_idx').on(t.orgId),
    uniqueIndex('sender_accounts_org_email_idx').on(
      t.orgId,
      sql`lower(${t.fromEmail})`,
    ),
  ],
);

// Public REST API keys. Only the SHA-256 hash is stored (like refresh tokens);
// the raw `ssk_...` key is shown once at creation. `prefix` is a short,
// non-secret identifier for display.
export const apiKeys = pgTable(
  'api_keys',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => orgs.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    keyHash: text('key_hash').notNull(),
    prefix: text('prefix').notNull(),
    // T2.9: per-key request budget (requests per minute, 1..6000).
    rateLimitPerMin: integer('rate_limit_per_min').notNull().default(120),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('api_keys_hash_idx').on(t.keyHash),
    index('api_keys_org_idx').on(t.orgId),
  ],
);

// CSV/Sheets import jobs. Row-level outcomes accumulate in `errors`; counters
// update as the BullMQ worker streams through the file.
export const importJobs = pgTable(
  'import_jobs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => orgs.id, { onDelete: 'cascade' }),
    source: text('source').notNull().default('csv'),
    status: text('status').notNull().default('pending'),
    total: integer('total').notNull().default(0),
    imported: integer('imported').notNull().default(0),
    updated: integer('updated').notNull().default(0),
    skipped: integer('skipped').notNull().default(0),
    errors: jsonb('errors')
      .notNull()
      .default(sql`'[]'::jsonb`),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
  },
  (t) => [index('import_jobs_org_idx').on(t.orgId, t.createdAt)],
);

// Append-only activity timeline. Email open/click/reply events append here as
// those subsystems land (E5); for now imports, edits, notes, status changes.
export const leadEvents = pgTable(
  'lead_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => orgs.id, { onDelete: 'cascade' }),
    leadId: uuid('lead_id')
      .notNull()
      .references(() => leads.id, { onDelete: 'cascade' }),
    type: text('type').notNull(),
    data: jsonb('data')
      .notNull()
      .default(sql`'{}'::jsonb`),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index('lead_events_lead_idx').on(t.leadId, t.createdAt)],
);

// ── E4: Templates ────────────────────────────────────────────────────────
// Reusable email templates, optionally grouped into folders. Subject + body
// carry personalization tokens like {first_name} / {company|there} resolved at
// render time (see templates/render.ts). body_html is the source of truth;
// body_text is an optional plaintext alternative.
export const templateFolders = pgTable(
  'template_folders',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => orgs.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex('template_folders_org_name_idx').on(
      t.orgId,
      sql`lower(${t.name})`,
    ),
  ],
);

export const templates = pgTable(
  'templates',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => orgs.id, { onDelete: 'cascade' }),
    folderId: uuid('folder_id').references(() => templateFolders.id, {
      onDelete: 'set null',
    }),
    name: text('name').notNull(),
    subject: text('subject').notNull().default(''),
    bodyHtml: text('body_html').notNull().default(''),
    bodyText: text('body_text'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index('templates_org_idx').on(t.orgId, t.createdAt)],
);

// ── E4: Campaigns ────────────────────────────────────────────────────────
// A campaign is a multi-step sequence sent to an audience (a segment, or all
// leads) from a rotating set of sender accounts. Steps carry a template, a
// delay, a send condition, and optional A/B subject variants. campaign_leads
// is the per-lead state machine the E5 sending engine advances.
export const campaignStatusEnum = pgEnum('campaign_status', [
  'draft',
  'scheduled',
  'active',
  'paused',
  'completed',
  'archived',
]);

// Gate for whether a follow-up step sends, evaluated against prior-step events
// (E5). Step 0 is effectively 'always'.
export const stepConditionEnum = pgEnum('step_condition', [
  'always',
  'opened_no_reply',
  'not_opened',
]);

export const campaignLeadStatusEnum = pgEnum('campaign_lead_status', [
  'active',
  'completed',
  'stopped',
]);

export const campaigns = pgTable(
  'campaigns',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => orgs.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    status: campaignStatusEnum('status').notNull().default('draft'),
    // Audience: a segment (null = all org leads at enroll time).
    segmentId: uuid('segment_id').references(() => segments.id, {
      onDelete: 'set null',
    }),
    // sender_account ids to rotate across (validated at launch).
    senderIds: jsonb('sender_ids')
      .notNull()
      .default(sql`'[]'::jsonb`),
    scheduledAt: timestamp('scheduled_at', { withTimezone: true }),
    startedAt: timestamp('started_at', { withTimezone: true }),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index('campaigns_org_idx').on(t.orgId, t.createdAt)],
);

export const campaignSteps = pgTable(
  'campaign_steps',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => orgs.id, { onDelete: 'cascade' }),
    campaignId: uuid('campaign_id')
      .notNull()
      .references(() => campaigns.id, { onDelete: 'cascade' }),
    stepOrder: integer('step_order').notNull(),
    templateId: uuid('template_id').references(() => templates.id, {
      onDelete: 'set null',
    }),
    // Hours to wait before this step (relative to the previous send / enroll).
    delayHours: integer('delay_hours').notNull().default(0),
    condition: stepConditionEnum('condition').notNull().default('always'),
    // A/B subject variants (strings). Empty = use the template's subject.
    subjectVariants: jsonb('subject_variants')
      .notNull()
      .default(sql`'[]'::jsonb`),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex('campaign_steps_order_idx').on(t.campaignId, t.stepOrder),
    index('campaign_steps_org_idx').on(t.orgId),
  ],
);

export const campaignLeads = pgTable(
  'campaign_leads',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => orgs.id, { onDelete: 'cascade' }),
    campaignId: uuid('campaign_id')
      .notNull()
      .references(() => campaigns.id, { onDelete: 'cascade' }),
    leadId: uuid('lead_id')
      .notNull()
      .references(() => leads.id, { onDelete: 'cascade' }),
    // 0-based index of the next step to send.
    currentStep: integer('current_step').notNull().default(0),
    status: campaignLeadStatusEnum('status').notNull().default('active'),
    stopReason: text('stop_reason'),
    nextSendAt: timestamp('next_send_at', { withTimezone: true }),
    // Opaque token for the per-recipient unsubscribe link.
    unsubToken: uuid('unsub_token').notNull().defaultRandom(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex('campaign_leads_unique_idx').on(t.campaignId, t.leadId),
    index('campaign_leads_due_idx').on(t.status, t.nextSendAt),
    index('campaign_leads_org_idx').on(t.orgId),
  ],
);

// ── E5: Sending, tracking & suppression ──────────────────────────────────
// One row per delivered (or attempted) email. tracking_id keys the open-pixel
// and click-redirect endpoints; variant_index records which A/B subject was used.
export const sentEmails = pgTable(
  'sent_emails',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => orgs.id, { onDelete: 'cascade' }),
    campaignId: uuid('campaign_id').references(() => campaigns.id, {
      onDelete: 'set null',
    }),
    campaignLeadId: uuid('campaign_lead_id').references(
      () => campaignLeads.id,
      {
        onDelete: 'set null',
      },
    ),
    leadId: uuid('lead_id').references(() => leads.id, {
      onDelete: 'set null',
    }),
    stepId: uuid('step_id').references(() => campaignSteps.id, {
      onDelete: 'set null',
    }),
    senderId: uuid('sender_id').references(() => senderAccounts.id, {
      onDelete: 'set null',
    }),
    toEmail: text('to_email').notNull(),
    subject: text('subject').notNull().default(''),
    messageId: text('message_id'),
    provider: text('provider'),
    status: text('status').notNull().default('sent'),
    variantIndex: integer('variant_index').notNull().default(0),
    trackingId: uuid('tracking_id').notNull().defaultRandom(),
    error: text('error'),
    sentAt: timestamp('sent_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('sent_emails_org_idx').on(t.orgId, t.sentAt),
    index('sent_emails_campaign_idx').on(t.campaignId),
    index('sent_emails_lead_idx').on(t.leadId),
    uniqueIndex('sent_emails_tracking_idx').on(t.trackingId),
    index('sent_emails_sender_day_idx').on(t.senderId, t.sentAt),
  ],
);

// Append-only email event log: sent / open / click / reply / bounce /
// complaint / unsubscribe. Feeds lead timeline + campaign stats.
export const emailEvents = pgTable(
  'email_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => orgs.id, { onDelete: 'cascade' }),
    sentEmailId: uuid('sent_email_id').references(() => sentEmails.id, {
      onDelete: 'cascade',
    }),
    campaignId: uuid('campaign_id'),
    leadId: uuid('lead_id'),
    type: text('type').notNull(),
    data: jsonb('data')
      .notNull()
      .default(sql`'{}'::jsonb`),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index('email_events_org_idx').on(t.orgId, t.createdAt),
    index('email_events_sent_idx').on(t.sentEmailId),
    index('email_events_campaign_idx').on(t.campaignId, t.type),
    index('email_events_lead_type_idx').on(t.leadId, t.type),
  ],
);

// ── E6: AI layer ─────────────────────────────────────────────────────────
// Per-org token usage log for every AI call (feature + model + token counts).
// Feeds usage metering + cost dashboards; append-only.
export const aiUsage = pgTable(
  'ai_usage',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => orgs.id, { onDelete: 'cascade' }),
    feature: text('feature').notNull(),
    provider: text('provider').notNull(),
    model: text('model').notNull(),
    inputTokens: integer('input_tokens').notNull().default(0),
    outputTokens: integer('output_tokens').notNull().default(0),
    promptVersion: text('prompt_version'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index('ai_usage_org_idx').on(t.orgId, t.createdAt)],
);

// Business Knowledge Base — one row per org, injected into every generative
// prompt so AI output is grounded in the org's real offer/audience/voice.
export const orgKnowledge = pgTable('org_knowledge', {
  orgId: uuid('org_id')
    .primaryKey()
    .references(() => orgs.id, { onDelete: 'cascade' }),
  description: text('description'),
  audience: text('audience'),
  offer: text('offer'),
  painPoints: text('pain_points'),
  usps: text('usps'),
  competitors: text('competitors'),
  testimonials: text('testimonials'),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// Do-not-contact list per org (unsubscribes, hard bounces, complaints).
// Enforced at send time (case-insensitive email match).
export const suppressionList = pgTable(
  'suppression_list',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => orgs.id, { onDelete: 'cascade' }),
    email: text('email').notNull(),
    reason: text('reason').notNull().default('unsubscribed'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex('suppression_org_email_idx').on(
      t.orgId,
      sql`lower(${t.email})`,
    ),
  ],
);

// ── E7: Unified inbox ────────────────────────────────────────────────────
// A conversation is a reply thread with one lead, usually tied to the
// campaign enrollment whose email they answered. Outbound emails already live
// in sent_emails; only inbound replies are stored as conversation_messages.
export const conversations = pgTable(
  'conversations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => orgs.id, { onDelete: 'cascade' }),
    leadId: uuid('lead_id')
      .notNull()
      .references(() => leads.id, { onDelete: 'cascade' }),
    campaignId: uuid('campaign_id').references(() => campaigns.id, {
      onDelete: 'set null',
    }),
    campaignLeadId: uuid('campaign_lead_id').references(
      () => campaignLeads.id,
      { onDelete: 'set null' },
    ),
    senderId: uuid('sender_id').references(() => senderAccounts.id, {
      onDelete: 'set null',
    }),
    subject: text('subject').notNull().default(''),
    status: text('status').notNull().default('open'),
    unread: boolean('unread').notNull().default(true),
    classification: text('classification'),
    confidence: real('confidence'),
    assignedUserId: uuid('assigned_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    convertedAt: timestamp('converted_at', { withTimezone: true }),
    lastMessageAt: timestamp('last_message_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index('conversations_org_idx').on(t.orgId, t.lastMessageAt),
    index('conversations_lead_idx').on(t.leadId),
  ],
);

export const conversationMessages = pgTable(
  'conversation_messages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => orgs.id, { onDelete: 'cascade' }),
    conversationId: uuid('conversation_id')
      .notNull()
      .references(() => conversations.id, { onDelete: 'cascade' }),
    direction: text('direction').notNull().default('inbound'),
    fromEmail: text('from_email').notNull(),
    toEmail: text('to_email'),
    subject: text('subject').notNull().default(''),
    bodyText: text('body_text').notNull().default(''),
    messageId: text('message_id'),
    inReplyTo: text('in_reply_to'),
    classification: text('classification'),
    confidence: real('confidence'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index('conversation_messages_conv_idx').on(t.conversationId, t.createdAt),
  ],
);

// Internal team notes on a conversation (never sent to the lead).
export const conversationNotes = pgTable(
  'conversation_notes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => orgs.id, { onDelete: 'cascade' }),
    conversationId: uuid('conversation_id')
      .notNull()
      .references(() => conversations.id, { onDelete: 'cascade' }),
    authorUserId: uuid('author_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    body: text('body').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index('conversation_notes_conv_idx').on(t.conversationId, t.createdAt),
  ],
);

// In-app notifications, fanned out one row per recipient so read state is
// per user.
export const notifications = pgTable(
  'notifications',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => orgs.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    type: text('type').notNull(),
    title: text('title').notNull(),
    body: text('body').notNull().default(''),
    link: text('link'),
    readAt: timestamp('read_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index('notifications_user_idx').on(t.userId, t.createdAt)],
);
