import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
} from '@nestjs/common';
import { Pool } from 'pg';
import { PG_POOL } from '../db/db.module';
import { withOrgContext } from '../db/tenant-context';
import { AiService } from './ai.service';
import type {
  CampaignFromSequenceDto,
  GenerateSequenceDto,
  UpsertKnowledgeDto,
} from './ai.dto';
import { OrgKnowledge, sequencePrompt } from './prompts';
import { UsageService } from '../usage/usage.service';

const KB_COLS = `description, audience, offer, pain_points AS "painPoints",
  usps, competitors, testimonials`;

export interface GeneratedStep {
  subject: string;
  body: string;
  delayHours: number;
}

@Injectable()
export class AiContentService {
  private readonly logger = new Logger(AiContentService.name);

  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    private readonly ai: AiService,
    private readonly usage: UsageService,
  ) {}

  // ── Knowledge base (T6.2) ────────────────────────────────────────────
  getKnowledge(orgId: string): Promise<OrgKnowledge | null> {
    return withOrgContext(this.pool, orgId, async (c) => {
      const res = await c.query<OrgKnowledge>(
        `SELECT ${KB_COLS} FROM org_knowledge WHERE org_id = $1`,
        [orgId],
      );
      return res.rows[0] ?? null;
    });
  }

  upsertKnowledge(
    orgId: string,
    dto: UpsertKnowledgeDto,
  ): Promise<OrgKnowledge> {
    return withOrgContext(this.pool, orgId, async (c) => {
      const res = await c.query<OrgKnowledge>(
        `INSERT INTO org_knowledge
           (org_id, description, audience, offer, pain_points, usps, competitors, testimonials)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
         ON CONFLICT (org_id) DO UPDATE SET
           description = EXCLUDED.description,
           audience = EXCLUDED.audience,
           offer = EXCLUDED.offer,
           pain_points = EXCLUDED.pain_points,
           usps = EXCLUDED.usps,
           competitors = EXCLUDED.competitors,
           testimonials = EXCLUDED.testimonials,
           updated_at = now()
         RETURNING ${KB_COLS}`,
        [
          orgId,
          dto.description ?? null,
          dto.audience ?? null,
          dto.offer ?? null,
          dto.painPoints ?? null,
          dto.usps ?? null,
          dto.competitors ?? null,
          dto.testimonials ?? null,
        ],
      );
      return res.rows[0];
    });
  }

  // ── Sequence generation (T6.3) ───────────────────────────────────────
  // Loads the org KB, runs the sequence prompt through the active provider, and
  // returns the parsed steps (a preview — nothing is persisted here).
  async generateSequence(
    orgId: string,
    dto: GenerateSequenceDto,
  ): Promise<{
    steps: GeneratedStep[];
    model: string;
    usage: { inputTokens: number; outputTokens: number };
  }> {
    // Checked before the (paid, slow) model call. Concurrent requests can
    // overshoot by a call or two; usage is logged after each generation.
    await withOrgContext(this.pool, orgId, (c) =>
      this.usage.assertCanAdd(c, orgId, 'aiGenerationsPerMonth'),
    );
    const kb = await this.getKnowledge(orgId);
    const opts = sequencePrompt({ ...dto, kb });
    const result = await this.ai.generate(orgId, 'sequence-gen', opts);

    let steps: GeneratedStep[] = [];
    try {
      const parsed = JSON.parse(result.text) as { steps?: unknown };
      if (Array.isArray(parsed.steps)) {
        steps = parsed.steps
          .map((s): GeneratedStep | null => {
            const step = s as Partial<GeneratedStep>;
            if (
              typeof step.subject !== 'string' ||
              typeof step.body !== 'string'
            ) {
              return null;
            }
            return {
              subject: step.subject,
              body: step.body,
              delayHours:
                typeof step.delayHours === 'number' ? step.delayHours : 0,
            };
          })
          .filter((s): s is GeneratedStep => s !== null);
      }
    } catch {
      this.logger.warn(
        `AI sequence output was not valid JSON (model ${result.model})`,
      );
    }

    return { steps, model: result.model, usage: result.usage };
  }

  // ── Approve → draft campaign (T6.3) ──────────────────────────────────
  // One transaction: a draft campaign + one template per step + one campaign
  // step referencing it. Reuses the existing send/render pipeline (steps carry a
  // template, delay, and default 'always' condition).
  async campaignFromSequence(orgId: string, dto: CampaignFromSequenceDto) {
    if (dto.segmentId) {
      const seg = await withOrgContext(this.pool, orgId, (c) =>
        c.query(`SELECT 1 FROM segments WHERE id = $1`, [dto.segmentId]),
      );
      if (seg.rowCount === 0) throw new BadRequestException('Unknown segment');
    }
    return withOrgContext(this.pool, orgId, async (c) => {
      await this.usage.assertSteps(c, orgId, dto.steps.length);
      const camp = await c.query<{ id: string; name: string; status: string }>(
        `INSERT INTO campaigns (org_id, name, segment_id, status)
         VALUES ($1, $2, $3, 'draft')
         RETURNING id, name, status`,
        [orgId, dto.name.trim(), dto.segmentId ?? null],
      );
      const campaignId = camp.rows[0].id;

      for (let i = 0; i < dto.steps.length; i++) {
        const step = dto.steps[i];
        const tpl = await c.query<{ id: string }>(
          `INSERT INTO templates (org_id, name, subject, body_html)
           VALUES ($1, $2, $3, $4) RETURNING id`,
          [
            orgId,
            `${dto.name.trim()} — step ${i + 1}`,
            step.subject,
            step.body,
          ],
        );
        await c.query(
          `INSERT INTO campaign_steps
             (org_id, campaign_id, step_order, template_id, delay_hours, condition)
           VALUES ($1,$2,$3,$4,$5,'always')`,
          [orgId, campaignId, i, tpl.rows[0].id, step.delayHours],
        );
      }

      return { ...camp.rows[0], steps: dto.steps.length };
    });
  }
}
