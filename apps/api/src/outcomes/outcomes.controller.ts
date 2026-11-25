import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { Type } from 'class-transformer';
import {
  IsDate,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import type { AuthUser } from '../auth/types';
import { VERIFICATIONS, type Verification } from './outcome-logic';
import { OutcomesService } from './outcomes.service';

export class VerifyOutcomeDto {
  @IsIn(['verified', 'rejected']) decision!: 'verified' | 'rejected';
  @IsOptional() @IsString() @MaxLength(500) reason?: string;
}

export class CreateOutcomeDto {
  @IsUUID() campaignLeadId!: string;
  @IsIn(['qualified_reply', 'booked_call']) type!:
    'qualified_reply' | 'booked_call';
  @Type(() => Date) @IsDate() occurredAt!: Date;
  @IsString() @MinLength(3) @MaxLength(500) reason!: string;
  // the client's own UUID: sending the same one twice records one outcome
  @IsUUID() idempotencyKey!: string;
}

export class RubricDto {
  @IsString() @MinLength(10) @MaxLength(2000) rubric!: string;
}

/**
 * Outcomes (T03). Confirming or rejecting is open to every role (an agent
 * reads the replies); the rubric is a workspace setting.
 */
@Controller()
export class OutcomesController {
  constructor(private readonly outcomes: OutcomesService) {}

  @Get('outcomes')
  list(
    @CurrentUser() user: AuthUser,
    @Query('status') status?: string,
    @Query('campaignId') campaignId?: string,
    @Query('conversationId') conversationId?: string,
  ) {
    return this.outcomes.list(user.orgId, {
      status: (VERIFICATIONS as readonly string[]).includes(status ?? '')
        ? (status as Verification)
        : undefined,
      campaignId: isUuid(campaignId) ? campaignId : undefined,
      conversationId: isUuid(conversationId) ? conversationId : undefined,
    });
  }

  // before ':id' routes so it is not read as an id
  @Get('outcomes/unattributed')
  unattributed(@CurrentUser() user: AuthUser) {
    return this.outcomes.unattributed(user.orgId);
  }

  @Get('outcomes/history/:conversationId')
  history(
    @CurrentUser() user: AuthUser,
    @Param('conversationId', ParseUUIDPipe) conversationId: string,
  ) {
    return this.outcomes.history(user.orgId, conversationId);
  }

  @Post('outcomes')
  @HttpCode(201)
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateOutcomeDto) {
    return this.outcomes.manual(user.orgId, user.userId, dto);
  }

  @Post('outcomes/:id/verify')
  @HttpCode(200)
  verify(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: VerifyOutcomeDto,
  ) {
    return this.outcomes.verify(
      user.orgId,
      user.userId,
      id,
      dto.decision,
      dto.reason,
    );
  }

  @Get('experiments/:id/outcome-coverage')
  coverage(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.outcomes.coverage(user.orgId, id);
  }

  @Get('review/rubric')
  rubric(@CurrentUser() user: AuthUser) {
    return this.outcomes.getRubric(user.orgId);
  }

  @Roles('admin', 'manager')
  @Put('review/rubric')
  setRubric(@CurrentUser() user: AuthUser, @Body() dto: RubricDto) {
    return this.outcomes.setRubric(user.orgId, dto.rubric);
  }
}

const isUuid = (v?: string): v is string =>
  !!v &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
