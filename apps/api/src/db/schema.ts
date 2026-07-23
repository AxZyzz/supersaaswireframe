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
} from 'drizzle-orm/pg-core';

// Tenant model: users are global (one login, many orgs); everything org-scoped
// carries org_id and is guarded by RLS (see the rls migration).

export const roleEnum = pgEnum('role', ['admin', 'manager', 'agent']);

export const orgs = pgTable('orgs', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  slug: text('slug').notNull().unique(),
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
