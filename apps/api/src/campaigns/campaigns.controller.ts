import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import type { AuthUser } from '../auth/types';
import {
  CreateCampaignDto,
  CreateStepDto,
  UpdateCampaignDto,
  UpdateStepDto,
} from './campaign.dto';
import { CampaignsService } from './campaigns.service';

@Controller('campaigns')
export class CampaignsController {
  constructor(private readonly campaigns: CampaignsService) {}

  // ── steps (two-segment routes; no clash with the ':id' routes) ────────
  @Roles('admin', 'manager')
  @Patch('steps/:stepId')
  updateStep(
    @CurrentUser() user: AuthUser,
    @Param('stepId', ParseUUIDPipe) stepId: string,
    @Body() dto: UpdateStepDto,
  ) {
    return this.campaigns.updateStep(user.orgId, stepId, dto);
  }

  @Roles('admin', 'manager')
  @Delete('steps/:stepId')
  removeStep(
    @CurrentUser() user: AuthUser,
    @Param('stepId', ParseUUIDPipe) stepId: string,
  ) {
    return this.campaigns.removeStep(user.orgId, stepId);
  }

  // ── campaigns ─────────────────────────────────────────────────────────
  @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.campaigns.list(user.orgId);
  }

  @Roles('admin', 'manager')
  @Post()
  @HttpCode(201)
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateCampaignDto) {
    return this.campaigns.create(user.orgId, dto);
  }

  @Get(':id')
  get(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.campaigns.get(user.orgId, id);
  }

  @Roles('admin', 'manager')
  @Patch(':id')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCampaignDto,
  ) {
    return this.campaigns.update(user.orgId, id, dto);
  }

  @Roles('admin', 'manager')
  @Delete(':id')
  remove(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.campaigns.remove(user.orgId, id);
  }

  @Roles('admin', 'manager')
  @Post(':id/archive')
  @HttpCode(200)
  archive(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.campaigns.archive(user.orgId, id);
  }

  @Get(':id/audience')
  audience(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.campaigns.audience(user.orgId, id);
  }

  @Get(':id/stats')
  stats(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.campaigns.stats(user.orgId, id);
  }

  @Roles('admin', 'manager')
  @Post(':id/enroll')
  @HttpCode(200)
  enroll(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.campaigns.enroll(user.orgId, id);
  }

  @Roles('admin', 'manager')
  @Post(':id/steps')
  @HttpCode(201)
  addStep(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateStepDto,
  ) {
    return this.campaigns.addStep(user.orgId, id, dto);
  }
}
