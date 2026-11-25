import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import {
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import type { AuthUser } from '../auth/types';
import { ReviewActionsService } from './review-actions.service';
import { ReviewService } from './review.service';
import { isScenario, SCENARIOS } from './simulation';

export class SimulateDto {
  @IsString() scenario!: string;
}

export class ApproveActionDto {
  /** The review revision the person was looking at. */
  @IsInt() @Min(1) revision!: number;
  /** Made when the confirm dialog opens; a repeat of it is a no-op. */
  @IsString() @MinLength(8) @MaxLength(100) idempotencyKey!: string;
  @IsOptional() @IsString() @MaxLength(500) reason?: string;
  /** approve_challenger: the drafted subject being approved. */
  @IsOptional() @IsUUID() draftId?: string;
}

export class ResumeVariantDto {
  @IsInt() @Min(1) @Max(100000) revision!: number;
  @IsString() @MinLength(8) @MaxLength(100) idempotencyKey!: string;
  @IsOptional() @IsString() @MaxLength(500) reason?: string;
}

export class RevertActionDto {
  @IsString() @MinLength(8) @MaxLength(100) idempotencyKey!: string;
  @IsString() @MinLength(1) @MaxLength(500) reason!: string;
}

/**
 * Review. T05: compute and show (everyone reads and can try the simulation;
 * refreshing is for admins and managers). T11: approve actions (keep, pause,
 * resume, challenger) with revision + idempotency key, audit and undo. Only
 * admins and managers act; the service checks the role again.
 */
@Controller()
export class ReviewController {
  constructor(
    private readonly review: ReviewService,
    private readonly actions: ReviewActionsService,
  ) {}

  @Get('campaigns/:id/review')
  latest(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.review.latestForCampaign(user.orgId, user.userId, id);
  }

  @Roles('admin', 'manager')
  @Post('campaigns/:id/review/refresh')
  @HttpCode(200)
  refresh(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.review.refresh(user.orgId, user.userId, id);
  }

  @Get('reviews/:id')
  one(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.review.get(user.orgId, id);
  }

  /** The scenarios the simulation dropdown offers. */
  @Get('review/scenarios')
  scenarios() {
    return SCENARIOS;
  }

  // Any role may try it and every call stores a (flagged) row, so it has its own
  // limit, tighter than the global 100/min (security review T18, finding 1).
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('review/simulate')
  @HttpCode(200)
  simulate(@CurrentUser() user: AuthUser, @Body() dto: SimulateDto) {
    if (!isScenario(dto.scenario)) {
      throw new BadRequestException(
        `Unknown scenario. Use one of: ${SCENARIOS.map((s) => s.id).join(', ')}`,
      );
    }
    return this.review.simulate(user.orgId, user.userId, dto.scenario);
  }

  // ── T11: actions ───────────────────────────────────────────────────────

  @Roles('admin', 'manager')
  @Post('reviews/:reviewId/actions/:actionId/approve')
  @HttpCode(200)
  approve(
    @CurrentUser() user: AuthUser,
    @Param('reviewId', ParseUUIDPipe) reviewId: string,
    @Param('actionId') actionId: string,
    @Body() dto: ApproveActionDto,
  ) {
    return this.actions.approve(user.orgId, user, reviewId, actionId, dto);
  }

  @Roles('admin', 'manager')
  @Post('experiments/:id/variants/:variantId/resume')
  @HttpCode(200)
  resume(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('variantId', ParseUUIDPipe) variantId: string,
    @Body() dto: ResumeVariantDto,
  ) {
    return this.actions.resume(user.orgId, user, id, variantId, dto);
  }

  @Roles('admin', 'manager')
  @Post('review-actions/:id/revert')
  @HttpCode(200)
  revert(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RevertActionDto,
  ) {
    return this.actions.revert(user.orgId, user, id, dto);
  }

  @Get('campaigns/:id/review/actions')
  history(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.actions.history(user.orgId, id);
  }

  @Roles('admin', 'manager')
  @Post('reviews/:id/challenger-drafts')
  @HttpCode(200)
  createDrafts(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.actions.createDrafts(user.orgId, user, id);
  }

  @Get('reviews/:id/challenger-drafts')
  listDrafts(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.actions.listDrafts(user.orgId, id);
  }
}
