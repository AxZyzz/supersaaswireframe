import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Pool, PoolClient } from 'pg';
import { PG_POOL } from '../db/db.module';
import { withOrgContext } from '../db/tenant-context';
import { UsageService } from '../usage/usage.service';
import type {
  CreateCampaignDto,
  CreateStepDto,
  UpdateCampaignDto,
  UpdateStepDto,
} from './campaign.dto';

const CAMPAIGN_COLS = `id, name, status, segment_id, sender_ids, scheduled_at,
  started_at, archived_at, created_at, updated_at`;
const STEP_COLS = `id, campaign_id, step_order, template_id, delay_hours,
  condition, subject_variants, created_at`;

export interface CampaignRow {
  id: string;
  name: string;
  status: string;
  segment_id: string | null;
  sender_ids: string[];
  scheduled_at: Date | null;
  started_at: Date | null;
  archived_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

export interface StepRow {
  id: string;
  campaign_id: string;
  step_order: number;
  template_id: string | null;
  delay_hours: number;
  condition: string;
  subject_variants: string[];
  created_at: Date;
}

@Injectable()
export class CampaignsService {
  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    private readonly usage: UsageService,
  ) {}

  private run<T>(orgId: string, fn: (c: PoolClient) => Promise<T>) {
    return withOrgContext(this.pool, orgId, fn);
  }

  // Guards a segment id belongs to this org (RLS makes cross-org rows invisible).
  private async assertSegment(c: PoolClient, segmentId: string) {
    const res = await c.query(`SELECT 1 FROM segments WHERE id = $1`, [
      segmentId,
    ]);
    if (res.rowCount === 0) throw new BadRequestException('Unknown segment');
  }

  list(orgId: string) {
    return this.run(orgId, async (c) => {
      const res = await c.query<CampaignRow & { steps: number; leads: number }>(
        `SELECT ${CAMPAIGN_COLS},
           (SELECT count(*)::int FROM campaign_steps s WHERE s.campaign_id = c.id) AS steps,
           (SELECT count(*)::int FROM campaign_leads l WHERE l.campaign_id = c.id) AS leads
         FROM campaigns c ORDER BY created_at DESC`,
      );
      return res.rows;
    });
  }

  create(orgId: string, dto: CreateCampaignDto) {
    return this.run(orgId, async (c) => {
      if (dto.segmentId) await this.assertSegment(c, dto.segmentId);
      const res = await c.query<CampaignRow>(
        `INSERT INTO campaigns (org_id, name, segment_id, sender_ids)
         VALUES ($1, $2, $3, COALESCE($4,'[]')::jsonb)
         RETURNING ${CAMPAIGN_COLS}`,
        [
          orgId,
          dto.name.trim(),
          dto.segmentId ?? null,
          dto.senderIds ? JSON.stringify(dto.senderIds) : null,
        ],
      );
      return res.rows[0];
    });
  }

  get(orgId: string, id: string) {
    return this.run(orgId, async (c) => {
      const camp = await c.query<CampaignRow>(
        `SELECT ${CAMPAIGN_COLS} FROM campaigns WHERE id = $1`,
        [id],
      );
      if (camp.rowCount === 0)
        throw new NotFoundException('Campaign not found');
      const steps = await c.query<StepRow>(
        `SELECT ${STEP_COLS} FROM campaign_steps WHERE campaign_id = $1
         ORDER BY step_order`,
        [id],
      );
      return { ...camp.rows[0], steps: steps.rows };
    });
  }

  async update(orgId: string, id: string, dto: UpdateCampaignDto) {
    const sets: string[] = [];
    const params: unknown[] = [];
    const add = (col: string, v: unknown) => {
      params.push(v);
      sets.push(`${col} = $${params.length}`);
    };
    return this.run(orgId, async (c) => {
      if (dto.name !== undefined) add('name', dto.name.trim());
      if (dto.status !== undefined) {
        params.push(dto.status);
        sets.push(`status = $${params.length}::campaign_status`);
      }
      if (dto.segmentId !== undefined) {
        if (dto.segmentId) await this.assertSegment(c, dto.segmentId);
        add('segment_id', dto.segmentId);
      }
      if (dto.senderIds !== undefined)
        add('sender_ids', JSON.stringify(dto.senderIds));
      if (dto.scheduledAt !== undefined) add('scheduled_at', dto.scheduledAt);
      if (sets.length === 0) return this.getRow(c, id);
      sets.push('updated_at = now()');
      params.push(id);
      const res = await c.query<CampaignRow>(
        `UPDATE campaigns SET ${sets.join(', ')} WHERE id = $${params.length}
         RETURNING ${CAMPAIGN_COLS}`,
        params,
      );
      if (res.rowCount === 0) throw new NotFoundException('Campaign not found');
      return res.rows[0];
    });
  }

  private async getRow(c: PoolClient, id: string) {
    const res = await c.query<CampaignRow>(
      `SELECT ${CAMPAIGN_COLS} FROM campaigns WHERE id = $1`,
      [id],
    );
    if (res.rowCount === 0) throw new NotFoundException('Campaign not found');
    return res.rows[0];
  }

  async remove(orgId: string, id: string) {
    const affected = await this.run(orgId, async (c) => {
      const res = await c.query(`DELETE FROM campaigns WHERE id = $1`, [id]);
      return res.rowCount ?? 0;
    });
    if (affected === 0) throw new NotFoundException('Campaign not found');
    return { deleted: true };
  }

  archive(orgId: string, id: string) {
    return this.run(orgId, async (c) => {
      const res = await c.query<CampaignRow>(
        `UPDATE campaigns SET status = 'archived', archived_at = now(),
           updated_at = now() WHERE id = $1 RETURNING ${CAMPAIGN_COLS}`,
        [id],
      );
      if (res.rowCount === 0) throw new NotFoundException('Campaign not found');
      return res.rows[0];
    });
  }

  // Clone a campaign + its sequence into a fresh draft (no leads, no history).
  duplicate(orgId: string, id: string) {
    return this.run(orgId, async (c) => {
      const src = await c.query<CampaignRow>(
        `SELECT ${CAMPAIGN_COLS} FROM campaigns WHERE id = $1`,
        [id],
      );
      if (src.rowCount === 0) throw new NotFoundException('Campaign not found');
      const s = src.rows[0];
      const dup = await c.query<CampaignRow>(
        `INSERT INTO campaigns (org_id, name, segment_id, sender_ids, status)
         VALUES ($1, $2, $3, $4::jsonb, 'draft')
         RETURNING ${CAMPAIGN_COLS}`,
        [
          orgId,
          `${s.name} (copy)`,
          s.segment_id,
          JSON.stringify(s.sender_ids ?? []),
        ],
      );
      await c.query(
        `INSERT INTO campaign_steps
           (org_id, campaign_id, step_order, template_id, delay_hours, condition, subject_variants)
         SELECT org_id, $2, step_order, template_id, delay_hours, condition, subject_variants
         FROM campaign_steps WHERE campaign_id = $1`,
        [id, dup.rows[0].id],
      );
      return dup.rows[0];
    });
  }

  // Status transitions. The send worker only touches 'active' campaigns, so a
  // pause immediately halts delivery; resume puts it back in the due scan.
  private setStatus(
    orgId: string,
    id: string,
    to: string,
    allowedFrom: string[],
  ) {
    return this.run(orgId, async (c) => {
      const cur = await c.query<{ status: string }>(
        `SELECT status FROM campaigns WHERE id = $1`,
        [id],
      );
      if (cur.rowCount === 0) throw new NotFoundException('Campaign not found');
      if (!allowedFrom.includes(cur.rows[0].status)) {
        throw new BadRequestException(
          `Cannot ${to === 'active' ? 'resume' : to} a ${cur.rows[0].status} campaign`,
        );
      }
      if (to === 'active') {
        await this.usage.assertCanAdd(c, orgId, 'activeCampaigns');
      }
      const res = await c.query<CampaignRow>(
        `UPDATE campaigns SET status = $2::campaign_status, updated_at = now()
         WHERE id = $1 RETURNING ${CAMPAIGN_COLS}`,
        [id, to],
      );
      return res.rows[0];
    });
  }

  pause(orgId: string, id: string) {
    return this.setStatus(orgId, id, 'paused', ['active', 'scheduled']);
  }

  resume(orgId: string, id: string) {
    return this.setStatus(orgId, id, 'active', ['paused']);
  }

  // Schedule a future start: materialize the audience now with each lead's first
  // send pinned to the scheduled time, and mark the campaign 'scheduled'. The
  // send worker promotes it to 'active' when the first send comes due.
  async schedule(orgId: string, id: string, scheduledAt: string) {
    const when = new Date(scheduledAt);
    if (Number.isNaN(when.getTime())) {
      throw new BadRequestException('Invalid schedule date');
    }
    if (when.getTime() <= Date.now()) {
      throw new BadRequestException('Schedule time must be in the future');
    }
    return this.run(orgId, async (c) => {
      const camp = await c.query<{ segment_id: string | null; status: string }>(
        `SELECT segment_id, status FROM campaigns WHERE id = $1`,
        [id],
      );
      if (camp.rowCount === 0)
        throw new NotFoundException('Campaign not found');
      if (camp.rows[0].status === 'archived') {
        throw new BadRequestException('Campaign is archived');
      }
      if (!['active', 'scheduled'].includes(camp.rows[0].status)) {
        await this.usage.assertCanAdd(c, orgId, 'activeCampaigns');
      }
      const first = await c.query<{ delay_hours: number }>(
        `SELECT delay_hours FROM campaign_steps WHERE campaign_id = $1
         ORDER BY step_order LIMIT 1`,
        [id],
      );
      if (first.rowCount === 0) {
        throw new BadRequestException(
          'Add at least one step before scheduling',
        );
      }
      const ins = await c.query(
        `INSERT INTO campaign_leads
           (org_id, campaign_id, lead_id, current_step, status, next_send_at)
         SELECT $1, $2, l.id, 0, 'active',
                $5::timestamptz + make_interval(hours => $3)
         FROM leads l
         WHERE ($4::uuid IS NULL
                OR l.id IN (SELECT lead_id FROM segment_members WHERE segment_id = $4))
         ON CONFLICT (campaign_id, lead_id) DO NOTHING`,
        [
          orgId,
          id,
          first.rows[0].delay_hours,
          camp.rows[0].segment_id,
          when.toISOString(),
        ],
      );
      const res = await c.query<CampaignRow>(
        `UPDATE campaigns SET status = 'scheduled', scheduled_at = $2,
           updated_at = now() WHERE id = $1 RETURNING ${CAMPAIGN_COLS}`,
        [id, when.toISOString()],
      );
      return { ...res.rows[0], enrolled: ins.rowCount ?? 0 };
    });
  }

  // ── steps ────────────────────────────────────────────────────────────
  async addStep(orgId: string, campaignId: string, dto: CreateStepDto) {
    return this.run(orgId, async (c) => {
      const camp = await c.query(`SELECT 1 FROM campaigns WHERE id = $1`, [
        campaignId,
      ]);
      if (camp.rowCount === 0)
        throw new NotFoundException('Campaign not found');
      const steps = await c.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM campaign_steps WHERE campaign_id = $1`,
        [campaignId],
      );
      await this.usage.assertSteps(c, orgId, steps.rows[0].n + 1);
      const next = await c.query<{ next: number }>(
        `SELECT COALESCE(max(step_order) + 1, 0) AS next
         FROM campaign_steps WHERE campaign_id = $1`,
        [campaignId],
      );
      const res = await c.query<StepRow>(
        `INSERT INTO campaign_steps
           (org_id, campaign_id, step_order, template_id, delay_hours, condition, subject_variants)
         VALUES ($1,$2,$3,$4,COALESCE($5,0),COALESCE($6::step_condition,'always'),COALESCE($7,'[]')::jsonb)
         RETURNING ${STEP_COLS}`,
        [
          orgId,
          campaignId,
          next.rows[0].next,
          dto.templateId ?? null,
          dto.delayHours ?? null,
          dto.condition ?? null,
          dto.subjectVariants ? JSON.stringify(dto.subjectVariants) : null,
        ],
      );
      return res.rows[0];
    });
  }

  async updateStep(orgId: string, stepId: string, dto: UpdateStepDto) {
    const sets: string[] = [];
    const params: unknown[] = [];
    const add = (col: string, v: unknown) => {
      params.push(v);
      sets.push(`${col} = $${params.length}`);
    };
    if (dto.templateId !== undefined) add('template_id', dto.templateId);
    if (dto.delayHours !== undefined) add('delay_hours', dto.delayHours);
    if (dto.condition !== undefined) {
      params.push(dto.condition);
      sets.push(`condition = $${params.length}::step_condition`);
    }
    if (dto.subjectVariants !== undefined)
      add('subject_variants', JSON.stringify(dto.subjectVariants));
    if (sets.length === 0) {
      return this.run(orgId, async (c) => {
        const res = await c.query<StepRow>(
          `SELECT ${STEP_COLS} FROM campaign_steps WHERE id = $1`,
          [stepId],
        );
        if (res.rowCount === 0) throw new NotFoundException('Step not found');
        return res.rows[0];
      });
    }
    params.push(stepId);
    return this.run(orgId, async (c) => {
      const res = await c.query<StepRow>(
        `UPDATE campaign_steps SET ${sets.join(', ')} WHERE id = $${params.length}
         RETURNING ${STEP_COLS}`,
        params,
      );
      if (res.rowCount === 0) throw new NotFoundException('Step not found');
      return res.rows[0];
    });
  }

  async removeStep(orgId: string, stepId: string) {
    const affected = await this.run(orgId, async (c) => {
      const res = await c.query(`DELETE FROM campaign_steps WHERE id = $1`, [
        stepId,
      ]);
      return res.rowCount ?? 0;
    });
    if (affected === 0) throw new NotFoundException('Step not found');
    return { deleted: true };
  }

  // ── stats ──────────────────────────────────────────────────────────────
  // Funnel + engagement for one campaign. Opens/clicks are counted by distinct
  // lead (unique rates); sent counts successful deliveries. Per-variant rows let
  // the UI compare A/B subject performance.
  stats(orgId: string, id: string) {
    return this.run(orgId, async (c) => {
      const camp = await c.query(`SELECT 1 FROM campaigns WHERE id = $1`, [id]);
      if (camp.rowCount === 0)
        throw new NotFoundException('Campaign not found');

      const leads = await c.query<{
        total: number;
        active: number;
        completed: number;
        stopped: number;
      }>(
        `SELECT count(*)::int AS total,
           count(*) FILTER (WHERE status = 'active')::int AS active,
           count(*) FILTER (WHERE status = 'completed')::int AS completed,
           count(*) FILTER (WHERE status = 'stopped')::int AS stopped
         FROM campaign_leads WHERE campaign_id = $1`,
        [id],
      );

      const sent = await c.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM sent_emails
         WHERE campaign_id = $1 AND status = 'sent'`,
        [id],
      );

      const ev = await c.query<{
        opened: number;
        clicked: number;
        unsubscribed: number;
        bounced: number;
      }>(
        `SELECT
           count(DISTINCT lead_id) FILTER (WHERE type = 'open')::int AS opened,
           count(DISTINCT lead_id) FILTER (WHERE type = 'click')::int AS clicked,
           count(*) FILTER (WHERE type = 'unsubscribe')::int AS unsubscribed,
           count(*) FILTER (WHERE type IN ('bounce', 'failed'))::int AS bounced
         FROM email_events WHERE campaign_id = $1`,
        [id],
      );

      const variants = await c.query<{
        variant_index: number;
        sent: number;
        opened: number;
        clicked: number;
      }>(
        `SELECT se.variant_index,
           count(DISTINCT se.id)::int AS sent,
           count(DISTINCT e.lead_id) FILTER (WHERE e.type = 'open')::int AS opened,
           count(DISTINCT e.lead_id) FILTER (WHERE e.type = 'click')::int AS clicked
         FROM sent_emails se
         LEFT JOIN email_events e ON e.sent_email_id = se.id
         WHERE se.campaign_id = $1 AND se.status = 'sent'
         GROUP BY se.variant_index
         ORDER BY se.variant_index`,
        [id],
      );

      return {
        leads: leads.rows[0],
        sent: sent.rows[0].n,
        opened: ev.rows[0].opened,
        clicked: ev.rows[0].clicked,
        unsubscribed: ev.rows[0].unsubscribed,
        bounced: ev.rows[0].bounced,
        variants: variants.rows,
      };
    });
  }

  // ── audience + enrollment ──────────────────────────────────────────────
  // How many leads would enroll: the campaign's segment members, or all org
  // leads if it has no segment.
  audience(orgId: string, id: string) {
    return this.run(orgId, async (c) => {
      const camp = await c.query<{ segment_id: string | null }>(
        `SELECT segment_id FROM campaigns WHERE id = $1`,
        [id],
      );
      if (camp.rowCount === 0)
        throw new NotFoundException('Campaign not found');
      const res = await c.query<{ count: number }>(
        `SELECT count(*)::int AS count FROM leads l
         WHERE ($1::uuid IS NULL
                OR l.id IN (SELECT lead_id FROM segment_members WHERE segment_id = $1))`,
        [camp.rows[0].segment_id],
      );
      return { count: res.rows[0].count };
    });
  }

  // Materialize per-lead state and flip the campaign active. The E5 sending
  // engine advances campaign_leads from here; this just seeds the state.
  async enroll(orgId: string, id: string) {
    return this.run(orgId, async (c) => {
      const camp = await c.query<{ segment_id: string | null; status: string }>(
        `SELECT segment_id, status FROM campaigns WHERE id = $1`,
        [id],
      );
      if (camp.rowCount === 0)
        throw new NotFoundException('Campaign not found');
      if (camp.rows[0].status === 'archived') {
        throw new BadRequestException('Campaign is archived');
      }
      if (!['active', 'scheduled'].includes(camp.rows[0].status)) {
        await this.usage.assertCanAdd(c, orgId, 'activeCampaigns');
      }
      const first = await c.query<{ delay_hours: number }>(
        `SELECT delay_hours FROM campaign_steps WHERE campaign_id = $1
         ORDER BY step_order LIMIT 1`,
        [id],
      );
      if (first.rowCount === 0) {
        throw new BadRequestException('Add at least one step before enrolling');
      }
      const ins = await c.query(
        `INSERT INTO campaign_leads
           (org_id, campaign_id, lead_id, current_step, status, next_send_at)
         SELECT $1, $2, l.id, 0, 'active', now() + make_interval(hours => $3)
         FROM leads l
         WHERE ($4::uuid IS NULL
                OR l.id IN (SELECT lead_id FROM segment_members WHERE segment_id = $4))
         ON CONFLICT (campaign_id, lead_id) DO NOTHING`,
        [orgId, id, first.rows[0].delay_hours, camp.rows[0].segment_id],
      );
      await c.query(
        `UPDATE campaigns SET status = 'active',
           started_at = COALESCE(started_at, now()), updated_at = now()
         WHERE id = $1`,
        [id],
      );
      return { enrolled: ins.rowCount ?? 0 };
    });
  }
}
