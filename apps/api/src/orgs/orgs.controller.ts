import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import type { AuthUser } from '../auth/types';
import { DeleteWorkspaceDto, UpdateOrgDto } from './orgs.dto';
import { OrgsService } from './orgs.service';
import { ChangeRoleDto, CreateInviteDto } from './team.dto';
import { TeamService } from './team.service';

@Controller('orgs')
export class OrgsController {
  constructor(
    private readonly orgs: OrgsService,
    private readonly team: TeamService,
  ) {}

  @Get('me')
  current(@CurrentUser() user: AuthUser) {
    return this.orgs.get(user.orgId);
  }

  @Roles('admin')
  @Patch('me')
  update(@CurrentUser() user: AuthUser, @Body() dto: UpdateOrgDto) {
    return this.orgs.update(user.orgId, dto);
  }

  @Get('me/setup')
  setup(@CurrentUser() user: AuthUser) {
    return this.orgs.setup(user.orgId);
  }

  /** GDPR export: everything the workspace holds, as a JSON download. */
  @Roles('admin')
  @Get('me/export')
  @Header('Content-Disposition', 'attachment; filename="workspace-export.json"')
  export(@CurrentUser() user: AuthUser) {
    return this.orgs.exportData(user.orgId);
  }

  /** Permanently delete the workspace (typed-name confirmation). */
  @Roles('admin')
  @Delete('me')
  deleteWorkspace(
    @CurrentUser() user: AuthUser,
    @Body() dto: DeleteWorkspaceDto,
  ) {
    return this.orgs.deleteWorkspace(user.orgId, dto.confirmName);
  }

  @Roles('admin')
  @Post('me/onboarding/complete')
  @HttpCode(200)
  completeOnboarding(@CurrentUser() user: AuthUser) {
    return this.orgs.completeOnboarding(user.orgId);
  }

  // ── Team ───────────────────────────────────────────────────────────────

  @Roles('admin', 'manager')
  @Get('members')
  members(@CurrentUser() user: AuthUser) {
    return this.team.members(user.orgId);
  }

  @Roles('admin')
  @Patch('members/:userId')
  changeRole(
    @CurrentUser() user: AuthUser,
    @Param('userId', ParseUUIDPipe) userId: string,
    @Body() dto: ChangeRoleDto,
  ) {
    return this.team.changeRole(user.orgId, userId, dto.role);
  }

  @Roles('admin')
  @Delete('members/:userId')
  removeMember(
    @CurrentUser() user: AuthUser,
    @Param('userId', ParseUUIDPipe) userId: string,
  ) {
    return this.team.removeMember(user.orgId, userId);
  }

  @Roles('admin')
  @Get('invites')
  invites(@CurrentUser() user: AuthUser) {
    return this.team.invites(user.orgId);
  }

  @Roles('admin')
  @Post('invites')
  @HttpCode(201)
  invite(@CurrentUser() user: AuthUser, @Body() dto: CreateInviteDto) {
    return this.team.createInvite(user.orgId, user.userId, dto.email, dto.role);
  }

  @Roles('admin')
  @Delete('invites/:id')
  revokeInvite(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.team.revokeInvite(user.orgId, id);
  }
}
