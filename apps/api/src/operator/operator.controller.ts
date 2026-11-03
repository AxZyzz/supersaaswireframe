import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  UseGuards,
} from '@nestjs/common';
import { IsIn } from 'class-validator';
import type { Plan } from '../usage/plan-limits';
import { OperatorGuard, OperatorOnly } from './operator.guard';
import { OperatorService } from './operator.service';

class SetPlanDto {
  @IsIn(['beta', 'internal']) plan!: Plan;
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

  @Get('failures')
  failures() {
    return this.ops.failures();
  }

  @Get('health')
  health() {
    return this.ops.health();
  }
}
