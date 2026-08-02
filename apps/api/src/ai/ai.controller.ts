import { Body, Controller, Get, HttpCode, Post, Put } from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import type { AuthUser } from '../auth/types';
import { AiContentService } from './ai-content.service';
import {
  CampaignFromSequenceDto,
  GenerateSequenceDto,
  UpsertKnowledgeDto,
} from './ai.dto';

@Controller('ai')
export class AiController {
  constructor(private readonly content: AiContentService) {}

  // ── Knowledge base ────────────────────────────────────────────────────
  @Get('knowledge')
  getKnowledge(@CurrentUser() user: AuthUser) {
    return this.content.getKnowledge(user.orgId);
  }

  @Roles('admin', 'manager')
  @Put('knowledge')
  upsertKnowledge(
    @CurrentUser() user: AuthUser,
    @Body() dto: UpsertKnowledgeDto,
  ) {
    return this.content.upsertKnowledge(user.orgId, dto);
  }

  // ── Campaign generation ────────────────────────────────────────────────
  @Roles('admin', 'manager')
  @Post('generate-sequence')
  @HttpCode(200)
  generateSequence(
    @CurrentUser() user: AuthUser,
    @Body() dto: GenerateSequenceDto,
  ) {
    return this.content.generateSequence(user.orgId, dto);
  }

  @Roles('admin', 'manager')
  @Post('campaigns/from-sequence')
  @HttpCode(201)
  campaignFromSequence(
    @CurrentUser() user: AuthUser,
    @Body() dto: CampaignFromSequenceDto,
  ) {
    return this.content.campaignFromSequence(user.orgId, dto);
  }
}
