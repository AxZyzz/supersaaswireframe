import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsIn,
  IsInt,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { Pool, PoolClient } from 'pg';
import { PG_POOL } from '../db/db.module';
import { withOrgContext } from '../db/tenant-context';
import { OffersService } from './offers.service';

export const DEFAULT_GUARDRAILS = {
  bounce: 0.05,
  unsubscribe: 0.02,
  complaint: 0.003,
};

export function throwExperimentFrozen(): never {
  throw new ConflictException({
    statusCode: 409,
    error: 'experiment_running',
    message: 'Editing copy creates a new test. Stop this one first.',
  });
}

export async function assertCampaignNotFrozenInTx(
  c: PoolClient,
  campaignId: string,
): Promise<void> {
  const r = await c.query(
    `SELECT 1 FROM experiments
     WHERE campaign_id = $1 AND status = 'running' LIMIT 1`,
    [campaignId],
  );
  if ((r.rowCount ?? 0) > 0) {
    throwExperimentFrozen();
  }
}

export async function assertTemplateNotFrozenInTx(
  c: PoolClient,
  templateId: string,
): Promise<void> {
  const r = await c.query(
    `SELECT 1 FROM experiments e
     JOIN campaign_steps s ON s.campaign_id = e.campaign_id
     WHERE e.status = 'running'
       AND (s.template_id = $1
            OR EXISTS (
              SELECT 1 FROM experiment_variants ev
              WHERE ev.experiment_id = e.id AND ev.template_id = $1
            ))
     LIMIT 1`,
    [templateId],
  );
  if ((r.rowCount ?? 0) > 0) {
    throwExperimentFrozen();
  }
}

export class ExperimentVariantInputDto {
  @IsOptional() @IsString() @MaxLength(40) label?: string;
  @IsString() @MinLength(1) @MaxLength(300) subject!: string;
}

export class CreateExperimentDto {
  @IsOptional() @IsUUID() stepId?: string;

  @IsArray()
  @ArrayMinSize(2)
  @ArrayMaxSize(2)
  @ValidateNested({ each: true })
  @Type(() => ExperimentVariantInputDto)
  variants!: ExperimentVariantInputDto[];

  @IsOptional()
  @IsIn(['qualified_reply', 'booked_call'])
  primaryMetric?: 'qualified_reply' | 'booked_call';

  @IsOptional()
  @IsIn(['booked_call', 'qualified_reply'])
  secondaryMetric?: 'booked_call' | 'qualified_reply';

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0.001)
  @Max(0.99)
  baselineRate?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0.1)
  @Max(50)
  minLiftPp?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(10)
  @Max(100000)
  targetNPerArm?: number | null;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(90)
  responseWindowDays?: number;

  @IsOptional()
  @IsDateString()
  decisionDate?: string | null;

  @IsOptional()
  @IsObject()
  guardrails?: Record<string, number>;
}

export class UpdateExperimentDto {
  @IsOptional()
  @IsArray()
  @ArrayMinSize(2)
  @ArrayMaxSize(2)
  @ValidateNested({ each: true })
  @Type(() => ExperimentVariantInputDto)
  variants?: ExperimentVariantInputDto[];

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0.001)
  @Max(0.99)
  baselineRate?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0.1)
  @Max(50)
  minLiftPp?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(10)
  @Max(100000)
  targetNPerArm?: number | null;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(90)
  responseWindowDays?: number;

  @IsOptional()
  @IsDateString()
  decisionDate?: string | null;

  @IsOptional()
  @IsObject()
  guardrails?: Record<string, number>;
}

export interface ExperimentRow {
  id: string;
  org_id: string;
  campaign_id: string;
  step_id: string;
  kind: string;
  status: string;
  unit: string;
  primary_metric: string;
  secondary_metric: string;
  baseline_rate: number;
  min_lift_pp: number;
  target_n_per_arm: number | null;
  response_window_days: number;
  decision_date: Date | null;
  guardrails: Record<string, number>;
  allocation: Record<string, unknown>;
  policy_version: string;
  offer_ref: string | null;
  created_by: string | null;
  started_at: Date | null;
  stopped_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

export interface ExperimentVariantRow {
  id: string;
  org_id: string;
  experiment_id: string;
  label: string;
  subject: string;
  template_id: string | null;
  template_version: number;
  is_control: boolean;
  status: string;
  created_by: string | null;
  approved_by: string | null;
  approved_at: Date | null;
  paused_by: string | null;
  paused_at: Date | null;
  pause_reason: string | null;
  resumed_by: string | null;
  resumed_at: Date | null;
  created_at: Date;
  assigned_companies?: number;
  sent_count?: number;
}

export interface ExperimentDetail extends ExperimentRow {
  variants: ExperimentVariantRow[];
  assigned_companies: number;
  ineligible_count: number;
}

const EXP_COLS = `id, org_id, campaign_id, step_id, kind, status, unit,
  primary_metric, secondary_metric, baseline_rate, min_lift_pp,
  target_n_per_arm, response_window_days, decision_date, guardrails,
  allocation, policy_version, offer_ref, created_by, started_at, stopped_at,
  created_at, updated_at`;

const VAR_COLS = `id, org_id, experiment_id, label, subject, template_id,
  template_version, is_control, status, created_by, approved_by, approved_at,
  paused_by, paused_at, pause_reason, resumed_by, resumed_at, created_at`;

@Injectable()
export class ExperimentsService {
  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    private readonly offers: OffersService,
  ) {}

  private run<T>(orgId: string, fn: (c: PoolClient) => Promise<T>) {
    return withOrgContext(this.pool, orgId, fn);
  }

  /**
   * Default baseline rate: workspace's own reply rate if it has >= 200 reached
   * companies, else 3% (0.03).
   */
  async defaultBaselineRate(c: PoolClient): Promise<number> {
    const r = await c.query<{ reached: number; replied: number }>(
      `SELECT
         count(DISTINCT COALESCE(l.company_key, lower(se.to_email)))::int AS reached,
         count(DISTINCT COALESCE(l.company_key, lower(se.to_email)))
           FILTER (WHERE EXISTS (
             SELECT 1 FROM email_events e
             WHERE e.lead_id = se.lead_id AND e.type = 'reply'
           ))::int AS replied
       FROM sent_emails se
       LEFT JOIN leads l ON l.id = se.lead_id
       WHERE se.status = 'sent'`,
    );
    const reached = r.rows[0]?.reached ?? 0;
    const replied = r.rows[0]?.replied ?? 0;
    if (reached >= 200 && replied > 0) {
      return Math.min(
        0.5,
        Math.max(0.005, Number((replied / reached).toFixed(4))),
      );
    }
    return 0.03;
  }

  private async hydrate(
    c: PoolClient,
    exp: ExperimentRow,
  ): Promise<ExperimentDetail> {
    const vars = await c.query<
      ExperimentVariantRow & { assigned_companies: number; sent_count: number }
    >(
      `SELECT ${VAR_COLS},
         (SELECT count(*)::int FROM experiment_assignments ea
          WHERE ea.experiment_id = ev.experiment_id AND ea.variant_id = ev.id) AS assigned_companies,
         (SELECT count(*)::int FROM sent_emails se
          WHERE se.experiment_id = ev.experiment_id AND se.variant_id = ev.id AND se.status = 'sent') AS sent_count
       FROM experiment_variants ev
       WHERE ev.experiment_id = $1
       ORDER BY ev.created_at ASC, ev.id ASC`,
      [exp.id],
    );
    const inelig = await c.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM campaign_leads
       WHERE campaign_id = $1 AND stop_reason = 'experiment_ineligible'`,
      [exp.campaign_id],
    );
    const totalAssigned = vars.rows.reduce(
      (sum, v) => sum + (v.assigned_companies ?? 0),
      0,
    );
    return {
      ...exp,
      variants: vars.rows,
      assigned_companies: totalAssigned,
      ineligible_count: inelig.rows[0]?.n ?? 0,
    };
  }

  async createForCampaign(
    orgId: string,
    userId: string,
    campaignId: string,
    dto: CreateExperimentDto,
  ): Promise<ExperimentDetail> {
    if (!Array.isArray(dto.variants) || dto.variants.length !== 2) {
      throw new BadRequestException(
        'V1 experiments require exactly 2 subject variants',
      );
    }
    const subjects = dto.variants.map((v) => (v.subject ?? '').trim());
    if (subjects.some((s) => !s)) {
      throw new BadRequestException('Both variant subjects are required');
    }

    return this.run(orgId, async (c) => {
      const camp = await c.query<{
        id: string;
        status: string;
        offer_id: string | null;
      }>(`SELECT id, status, offer_id FROM campaigns WHERE id = $1`, [
        campaignId,
      ]);
      if (camp.rowCount === 0) {
        throw new NotFoundException('Campaign not found');
      }
      const campRow = camp.rows[0];
      if (!['draft', 'paused'].includes(campRow.status)) {
        throw new BadRequestException(
          'Experiments can only be created while the campaign is draft or paused',
        );
      }

      await assertCampaignNotFrozenInTx(c, campaignId);

      // Step 1 check: must be step_order = 0
      const stepRes = dto.stepId
        ? await c.query<{
            id: string;
            step_order: number;
            template_id: string | null;
          }>(
            `SELECT id, step_order, template_id FROM campaign_steps
             WHERE id = $1 AND campaign_id = $2`,
            [dto.stepId, campaignId],
          )
        : await c.query<{
            id: string;
            step_order: number;
            template_id: string | null;
          }>(
            `SELECT id, step_order, template_id FROM campaign_steps
             WHERE campaign_id = $1 ORDER BY step_order ASC LIMIT 1`,
            [campaignId],
          );

      if (stepRes.rowCount === 0) {
        throw new BadRequestException(
          'Add step 1 to the campaign before setting up an experiment',
        );
      }
      const step = stepRes.rows[0];
      if (step.step_order !== 0) {
        throw new BadRequestException(
          'Experiments are allowed only on step 1 (first touch) in V1',
        );
      }

      const offerId = await this.offers.resolveOfferIdInTx(
        c,
        orgId,
        campRow.offer_id,
      );
      if (!campRow.offer_id) {
        await c.query(`UPDATE campaigns SET offer_id = $2 WHERE id = $1`, [
          campaignId,
          offerId,
        ]);
      }

      const baselineRate =
        dto.baselineRate ?? (await this.defaultBaselineRate(c));
      const minLiftPp = dto.minLiftPp ?? 2;
      const responseWindowDays = dto.responseWindowDays ?? 14;
      const guardrails = {
        ...DEFAULT_GUARDRAILS,
        ...(dto.guardrails ?? {}),
      };

      const expRes = await c.query<ExperimentRow>(
        `INSERT INTO experiments
           (org_id, campaign_id, step_id, kind, status, unit,
            primary_metric, secondary_metric, baseline_rate, min_lift_pp,
            target_n_per_arm, response_window_days, decision_date,
            guardrails, allocation, policy_version, offer_ref, created_by)
         VALUES ($1,$2,$3,'subject','draft','company',$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12::jsonb,'v1',$13,$14)
         RETURNING ${EXP_COLS}`,
        [
          orgId,
          campaignId,
          step.id,
          dto.primaryMetric ?? 'qualified_reply',
          dto.secondaryMetric ?? 'booked_call',
          baselineRate,
          minLiftPp,
          dto.targetNPerArm ?? null,
          responseWindowDays,
          dto.decisionDate ? new Date(dto.decisionDate).toISOString() : null,
          JSON.stringify(guardrails),
          JSON.stringify({ weights: [0.5, 0.5] }),
          offerId,
          userId,
        ],
      );
      const exp = expRes.rows[0];

      for (let i = 0; i < dto.variants.length; i++) {
        const v = dto.variants[i];
        const label = (v.label ?? '').trim() || (i === 0 ? 'A' : 'B');
        await c.query(
          `INSERT INTO experiment_variants
             (org_id, experiment_id, label, subject, template_id, template_version,
              is_control, status, created_by)
           VALUES ($1,$2,$3,$4,$5,1,$6,'active',$7)`,
          [
            orgId,
            exp.id,
            label,
            subjects[i],
            step.template_id,
            i === 0,
            userId,
          ],
        );
      }

      return this.hydrate(c, exp);
    });
  }

  listForCampaign(
    orgId: string,
    campaignId: string,
  ): Promise<ExperimentDetail[]> {
    return this.run(orgId, async (c) => {
      const camp = await c.query(`SELECT 1 FROM campaigns WHERE id = $1`, [
        campaignId,
      ]);
      if (camp.rowCount === 0) {
        throw new NotFoundException('Campaign not found');
      }
      const exps = await c.query<ExperimentRow>(
        `SELECT ${EXP_COLS} FROM experiments
         WHERE campaign_id = $1
         ORDER BY (status = 'running') DESC, created_at DESC`,
        [campaignId],
      );
      const out: ExperimentDetail[] = [];
      for (const e of exps.rows) {
        out.push(await this.hydrate(c, e));
      }
      return out;
    });
  }

  get(orgId: string, id: string): Promise<ExperimentDetail> {
    return this.run(orgId, async (c) => {
      const r = await c.query<ExperimentRow>(
        `SELECT ${EXP_COLS} FROM experiments WHERE id = $1`,
        [id],
      );
      if (r.rowCount === 0) {
        throw new NotFoundException('Experiment not found');
      }
      return this.hydrate(c, r.rows[0]);
    });
  }

  update(
    orgId: string,
    id: string,
    dto: UpdateExperimentDto,
  ): Promise<ExperimentDetail> {
    return this.run(orgId, async (c) => {
      const cur = await c.query<ExperimentRow>(
        `SELECT ${EXP_COLS} FROM experiments WHERE id = $1`,
        [id],
      );
      if (cur.rowCount === 0) {
        throw new NotFoundException('Experiment not found');
      }
      const exp = cur.rows[0];
      if (exp.status === 'running') {
        throwExperimentFrozen();
      }
      if (exp.status !== 'draft') {
        throw new BadRequestException(`Cannot edit a ${exp.status} experiment`);
      }

      const sets: string[] = [];
      const params: unknown[] = [];
      const add = (col: string, val: unknown) => {
        params.push(val);
        sets.push(`${col} = $${params.length}`);
      };
      if (dto.baselineRate !== undefined)
        add('baseline_rate', dto.baselineRate);
      if (dto.minLiftPp !== undefined) add('min_lift_pp', dto.minLiftPp);
      if (dto.targetNPerArm !== undefined)
        add('target_n_per_arm', dto.targetNPerArm);
      if (dto.responseWindowDays !== undefined)
        add('response_window_days', dto.responseWindowDays);
      if (dto.decisionDate !== undefined) {
        add(
          'decision_date',
          dto.decisionDate ? new Date(dto.decisionDate).toISOString() : null,
        );
      }
      if (dto.guardrails !== undefined) {
        params.push(
          JSON.stringify({ ...DEFAULT_GUARDRAILS, ...dto.guardrails }),
        );
        sets.push(`guardrails = $${params.length}::jsonb`);
      }

      let updated = exp;
      if (sets.length > 0) {
        sets.push('updated_at = now()');
        params.push(id);
        const r = await c.query<ExperimentRow>(
          `UPDATE experiments SET ${sets.join(', ')}
           WHERE id = $${params.length} RETURNING ${EXP_COLS}`,
          params,
        );
        updated = r.rows[0];
      }

      if (dto.variants) {
        if (dto.variants.length !== 2) {
          throw new BadRequestException(
            'V1 experiments require exactly 2 subject variants',
          );
        }
        const existingVars = await c.query<{ id: string }>(
          `SELECT id FROM experiment_variants
           WHERE experiment_id = $1 ORDER BY created_at ASC, id ASC`,
          [id],
        );
        for (let i = 0; i < Math.min(2, existingVars.rows.length); i++) {
          const v = dto.variants[i];
          const subj = (v.subject ?? '').trim();
          if (!subj) {
            throw new BadRequestException('Both variant subjects are required');
          }
          const lbl = (v.label ?? '').trim() || (i === 0 ? 'A' : 'B');
          await c.query(
            `UPDATE experiment_variants SET label = $2, subject = $3 WHERE id = $1`,
            [existingVars.rows[i].id, lbl, subj],
          );
        }
      }

      return this.hydrate(c, updated);
    });
  }

  start(orgId: string, id: string): Promise<ExperimentDetail> {
    return this.run(orgId, async (c) => {
      const cur = await c.query<ExperimentRow>(
        `SELECT ${EXP_COLS} FROM experiments WHERE id = $1`,
        [id],
      );
      if (cur.rowCount === 0) {
        throw new NotFoundException('Experiment not found');
      }
      const exp = cur.rows[0];
      if (exp.status === 'running') {
        return this.hydrate(c, exp);
      }
      if (exp.status !== 'draft') {
        throw new BadRequestException(
          `Cannot start a ${exp.status} experiment`,
        );
      }

      // Enforce one running experiment per (campaign_id, step_id)
      const clash = await c.query(
        `SELECT 1 FROM experiments
         WHERE campaign_id = $1 AND status = 'running' AND id <> $2 LIMIT 1`,
        [exp.campaign_id, id],
      );
      if ((clash.rowCount ?? 0) > 0) {
        throwExperimentFrozen();
      }

      const vars = await c.query<{ id: string; subject: string }>(
        `SELECT id, subject FROM experiment_variants
         WHERE experiment_id = $1 AND status = 'active'`,
        [id],
      );
      if (vars.rows.length < 2 || vars.rows.some((v) => !v.subject.trim())) {
        throw new BadRequestException(
          'Experiment needs 2 active subject variants to start',
        );
      }

      const r = await c.query<ExperimentRow>(
        `UPDATE experiments
         SET status = 'running',
             started_at = COALESCE(started_at, now()),
             updated_at = now()
         WHERE id = $1
         RETURNING ${EXP_COLS}`,
        [id],
      );
      return this.hydrate(c, r.rows[0]);
    });
  }

  stop(orgId: string, id: string): Promise<ExperimentDetail> {
    return this.run(orgId, async (c) => {
      const cur = await c.query<ExperimentRow>(
        `SELECT ${EXP_COLS} FROM experiments WHERE id = $1`,
        [id],
      );
      if (cur.rowCount === 0) {
        throw new NotFoundException('Experiment not found');
      }
      const exp = cur.rows[0];
      if (exp.status === 'stopped') {
        return this.hydrate(c, exp);
      }
      const r = await c.query<ExperimentRow>(
        `UPDATE experiments
         SET status = 'stopped',
             stopped_at = COALESCE(stopped_at, now()),
             updated_at = now()
         WHERE id = $1
         RETURNING ${EXP_COLS}`,
        [id],
      );
      return this.hydrate(c, r.rows[0]);
    });
  }
}
