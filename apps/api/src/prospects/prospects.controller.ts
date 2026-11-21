import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import type { AuthUser } from '../auth/types';
import { AddProspectsToLeadsDto, StartProspectRunDto } from './prospects.dto';
import { ProspectsService } from './prospects.service';

/** Expelly prospect discovery: find, verify and qualify companies for a goal. */
@Controller('prospects')
export class ProspectsController {
  constructor(private readonly prospects: ProspectsService) {}

  // Each run spends AI calls and reads websites: managers only, rate-limited.
  @Roles('admin', 'manager')
  @Throttle({ default: { limit: 6, ttl: 60_000 } })
  @Post('runs')
  start(@CurrentUser() user: AuthUser, @Body() dto: StartProspectRunDto) {
    return this.prospects.startRun(
      user.orgId,
      user.userId,
      dto.goal,
      dto.count,
      dto.offerId,
    );
  }

  @Get('runs')
  list(@CurrentUser() user: AuthUser) {
    return this.prospects.listRuns(user.orgId);
  }

  @Get('runs/:id')
  get(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.prospects.getRun(user.orgId, id);
  }

  @Roles('admin', 'manager')
  @HttpCode(200)
  @Post('add-to-leads')
  addToLeads(
    @CurrentUser() user: AuthUser,
    @Body() dto: AddProspectsToLeadsDto,
  ) {
    return this.prospects.addToLeads(
      user.orgId,
      dto.prospectIds,
      dto.segmentName,
    );
  }
}
