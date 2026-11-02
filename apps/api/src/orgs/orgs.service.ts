import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { MembershipCache } from '../auth/membership-cache.service';
import { Pool } from 'pg';
import { PG_POOL } from '../db/db.module';
import { withOrgContext } from '../db/tenant-context';
import type { UpdateOrgDto } from './orgs.dto';

export interface OrgProfile {
  id: string;
  name: string;
  slug: string;
  website: string | null;
  industry: string | null;
  team_size: string | null;
  timezone: string;
  brand_color: string | null;
  logo_data: string | null;
  onboarded_at: string | null;
  postal_address: string | null;
}

/** "Start here" progress — drives the onboarding Done step and the
 *  dashboard checklist. Each flag is one cheap EXISTS. */
export interface SetupStatus {
  profile: boolean;
  knowledge: boolean;
  sender: boolean;
  senderVerified: boolean;
  leads: boolean;
  campaign: boolean;
  onboarded: boolean;
}

const COLUMNS = `id, name, slug, website, industry, team_size, timezone,
  brand_color, logo_data, onboarded_at, postal_address`;

// DTO key -> column. A whitelist, so SET clauses are never built from input.
const FIELDS: Record<string, string> = {
  name: 'name',
  website: 'website',
  industry: 'industry',
  teamSize: 'team_size',
  timezone: 'timezone',
  brandColor: 'brand_color',
  logoData: 'logo_data',
  postalAddress: 'postal_address',
};

// DateTimeFormat accepts every IANA name incl. aliases (Asia/Kolkata), which
// Intl.supportedValuesOf omits in favour of canonical ones (Asia/Calcutta).
const isTimeZone = (tz: string) => {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
};

@Injectable()
export class OrgsService {
  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    private readonly memberships: MembershipCache,
  ) {}

  get(orgId: string) {
    return withOrgContext(this.pool, orgId, async (c) => {
      const r = await c.query<OrgProfile>(
        `SELECT ${COLUMNS} FROM orgs WHERE id = $1`,
        [orgId],
      );
      return r.rows[0] ?? null;
    });
  }

  update(orgId: string, dto: UpdateOrgDto) {
    if (dto.name !== undefined && !dto.name.trim()) {
      throw new BadRequestException('Workspace name is required');
    }
    if (dto.timezone !== undefined && !isTimeZone(dto.timezone)) {
      throw new BadRequestException('Unknown timezone');
    }
    const sets: string[] = [];
    const vals: unknown[] = [orgId];
    for (const [key, col] of Object.entries(FIELDS)) {
      const v = (dto as Record<string, unknown>)[key];
      if (v === undefined) continue;
      vals.push(typeof v === 'string' ? v.trim() || null : v);
      sets.push(`${col} = $${vals.length}`);
    }
    return withOrgContext(this.pool, orgId, async (c) => {
      if (sets.length) {
        await c.query(
          `UPDATE orgs SET ${sets.join(', ')}, updated_at = now() WHERE id = $1`,
          vals,
        );
      }
      const r = await c.query<OrgProfile>(
        `SELECT ${COLUMNS} FROM orgs WHERE id = $1`,
        [orgId],
      );
      return r.rows[0];
    });
  }

  completeOnboarding(orgId: string) {
    return withOrgContext(this.pool, orgId, async (c) => {
      const r = await c.query<{ onboarded_at: string }>(
        `UPDATE orgs SET onboarded_at = COALESCE(onboarded_at, now()),
                updated_at = now()
         WHERE id = $1 RETURNING onboarded_at`,
        [orgId],
      );
      return { onboardedAt: r.rows[0]?.onboarded_at ?? null };
    });
  }

  setup(orgId: string): Promise<SetupStatus> {
    return withOrgContext(this.pool, orgId, async (c) => {
      const r = await c.query<SetupStatus>(
        `SELECT
           (o.industry IS NOT NULL OR o.website IS NOT NULL) AS profile,
           EXISTS (SELECT 1 FROM org_knowledge k
                   WHERE COALESCE(k.description, k.offer, k.audience) IS NOT NULL) AS knowledge,
           EXISTS (SELECT 1 FROM sender_accounts) AS sender,
           EXISTS (SELECT 1 FROM sender_accounts WHERE status = 'verified') AS "senderVerified",
           EXISTS (SELECT 1 FROM leads) AS leads,
           EXISTS (SELECT 1 FROM campaigns) AS campaign,
           (o.onboarded_at IS NOT NULL) AS onboarded
         FROM orgs o WHERE o.id = $1`,
        [orgId],
      );
      return r.rows[0];
    });
  }

  /**
   * Permanently deletes the workspace and everything in it (FK cascades).
   * Members whose only workspace this was lose their now-empty accounts too —
   * an account without a workspace can't sign in or be used for anything.
   */
  async deleteWorkspace(orgId: string, confirmName: string) {
    const members = await withOrgContext(this.pool, orgId, async (c) => {
      const org = await c.query<{ name: string }>(
        `SELECT name FROM orgs WHERE id = $1`,
        [orgId],
      );
      if (!org.rows[0]) throw new NotFoundException('Workspace not found');
      if (confirmName.trim() !== org.rows[0].name) {
        throw new BadRequestException(
          'Type the workspace name exactly to confirm deletion',
        );
      }
      const m = await c.query<{ user_id: string }>(
        `SELECT user_id FROM memberships`,
      );
      await c.query(`DELETE FROM orgs WHERE id = $1`, [orgId]);
      return m.rows.map((r) => r.user_id);
    });

    let accountsRemoved = 0;
    for (const userId of members) {
      this.memberships.invalidate(userId);
      const left = await this.pool.query(
        `SELECT 1 FROM user_memberships($1) LIMIT 1`,
        [userId],
      );
      if (!left.rowCount) {
        await this.pool.query(`DELETE FROM users WHERE id = $1`, [userId]);
        accountsRemoved++;
      }
    }
    return { deleted: true, accountsRemoved };
  }

  /** GDPR access/portability: everything the workspace holds, as JSON. */
  exportData(orgId: string) {
    return withOrgContext(this.pool, orgId, async (c) => {
      type Row = Record<string, unknown>;
      const q = async (sql: string) => (await c.query<Row>(sql)).rows;
      return {
        exportedAt: new Date().toISOString(),
        workspace: (
          await c.query<Row>(
            `SELECT ${COLUMNS}, plan, created_at FROM orgs WHERE id = $1`,
            [orgId],
          )
        ).rows[0],
        members: await q(
          `SELECT u.name, u.email, m.role, m.created_at
           FROM memberships m JOIN users u ON u.id = m.user_id ORDER BY m.created_at`,
        ),
        knowledge: await q(`SELECT * FROM org_knowledge`),
        leads: await q(`SELECT * FROM leads ORDER BY created_at`),
        tags: await q(`SELECT * FROM tags ORDER BY name`),
        leadTags: await q(`SELECT lead_id, tag_id FROM lead_tags`),
        leadNotes: await q(`SELECT * FROM lead_notes ORDER BY created_at`),
        segments: await q(`SELECT * FROM segments ORDER BY created_at`),
        templates: await q(`SELECT * FROM templates ORDER BY created_at`),
        campaigns: await q(`SELECT * FROM campaigns ORDER BY created_at`),
        campaignSteps: await q(
          `SELECT * FROM campaign_steps ORDER BY campaign_id, step_order`,
        ),
        sentEmails: await q(
          `SELECT id, campaign_id, lead_id, to_email, subject, status, sent_at
           FROM sent_emails ORDER BY sent_at`,
        ),
        emailEvents: await q(
          `SELECT type, sent_email_id, created_at FROM email_events ORDER BY created_at`,
        ),
        conversations: await q(
          `SELECT * FROM conversations ORDER BY created_at`,
        ),
        conversationMessages: await q(
          `SELECT * FROM conversation_messages ORDER BY created_at`,
        ),
        conversationNotes: await q(
          `SELECT * FROM conversation_notes ORDER BY created_at`,
        ),
        suppressionList: await q(
          `SELECT email, reason, created_at FROM suppression_list`,
        ),
        // Sender credentials are encrypted secrets; identities only.
        senders: await q(
          `SELECT id, provider, from_name, from_email, daily_limit, status, created_at
           FROM sender_accounts`,
        ),
      };
    });
  }
}
