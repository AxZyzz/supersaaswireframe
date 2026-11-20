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
import { IsString } from 'class-validator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import type { AuthUser } from '../auth/types';
import { ReviewService } from './review.service';
import { isScenario, SCENARIOS } from './simulation';

export class SimulateDto {
  @IsString() scenario!: string;
}

/**
 * Review (T05). Read-only: it computes and shows; approving anything arrives
 * with T11/T12. Everyone can read and try the simulation; refreshing is for
 * admins and managers.
 */
@Controller()
export class ReviewController {
  constructor(private readonly review: ReviewService) {}

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
}
