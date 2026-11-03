import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  HttpCode,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { IsIn, IsString, MaxLength, MinLength } from 'class-validator';
import type { Plan } from '../usage/plan-limits';
import { OperatorGuard, OperatorOnly } from './operator.guard';
import { OperatorService } from './operator.service';

class SetPlanDto {
  @IsIn(['beta', 'internal']) plan!: Plan;
}

class PauseCampaignsDto {
  /** Shown to the workspace's members in their notification. */
  @IsString() @MinLength(5) @MaxLength(500) reason!: string;
}

/** A2B staff console (T8.6): platform health across every workspace. */
@OperatorOnly()
@UseGuards(OperatorGuard)
@Controller('operator')
export class OperatorController {
  constructor(private readonly ops: OperatorService) {}

  @Get('overview')
  overview() {
    return this.ops.overview();
  }

  @Get('orgs')
  orgs() {
    return this.ops.orgs();
  }

  @Get('orgs/:id')
  org(@Param('id', ParseUUIDPipe) id: string) {
    return this.ops.org(id);
  }

  @Patch('orgs/:id/plan')
  setPlan(@Param('id', ParseUUIDPipe) id: string, @Body() dto: SetPlanDto) {
    return this.ops.setPlan(id, dto.plan);
  }

  // Incident brake: pause all of one workspace's sending campaigns.
  @Post('orgs/:id/pause-campaigns')
  @HttpCode(200)
  pauseCampaigns(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: PauseCampaignsDto,
  ) {
    return this.ops.pauseCampaigns(id, dto.reason.trim());
  }

  @Get('failures')
  failures() {
    return this.ops.failures();
  }

  @Get('health')
  health() {
    return this.ops.health();
  }
}
