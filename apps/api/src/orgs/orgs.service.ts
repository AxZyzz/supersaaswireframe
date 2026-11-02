import { BadRequestException, Inject, Injectable } from '@nestjs/common';
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
  brand_color, logo_data, onboarded_at`;

// DTO key -> column. A whitelist, so SET clauses are never built from input.
const FIELDS: Record<string, string> = {
  name: 'name',
  website: 'website',
  industry: 'industry',
  teamSize: 'team_size',
  timezone: 'timezone',
  brandColor: 'brand_color',
  logoData: 'logo_data',
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
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

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
}
