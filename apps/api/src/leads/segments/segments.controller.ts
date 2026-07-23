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
  Query,
} from '@nestjs/common';
import { IsArray, IsUUID, ArrayNotEmpty } from 'class-validator';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { Roles } from '../../auth/decorators/roles.decorator';
import type { AuthUser } from '../../auth/types';
import { CreateSegmentDto, UpdateSegmentDto } from './segment.dto';
import { SegmentsService } from './segments.service';

class AddMembersDto {
  @IsArray()
  @ArrayNotEmpty()
  @IsUUID('4', { each: true })
  leadIds!: string[];
}

@Controller('segments')
export class SegmentsController {
  constructor(private readonly segments: SegmentsService) {}

  @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.segments.list(user.orgId);
  }

  @Roles('admin', 'manager')
  @Post()
  @HttpCode(201)
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateSegmentDto) {
    return this.segments.create(user.orgId, dto);
  }

  @Get(':id')
  get(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.segments.get(user.orgId, id);
  }

  @Get(':id/leads')
  members(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    return this.segments.members(
      user.orgId,
      id,
      limit ? Math.min(Number(limit), 200) : 50,
      offset ? Number(offset) : 0,
    );
  }

  @Roles('admin', 'manager')
  @Patch(':id')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateSegmentDto,
  ) {
    return this.segments.update(user.orgId, id, dto);
  }

  @Roles('admin', 'manager')
  @Delete(':id')
  remove(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.segments.remove(user.orgId, id);
  }

  @Roles('admin', 'manager')
  @HttpCode(200)
  @Post(':id/refresh')
  refresh(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.segments.requestRefresh(user.orgId, id);
  }

  @Roles('admin', 'manager')
  @HttpCode(200)
  @Post(':id/members')
  addMembers(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AddMembersDto,
  ) {
    return this.segments.addMembers(user.orgId, id, dto.leadIds);
  }

  @Roles('admin', 'manager')
  @Delete(':id/members/:leadId')
  removeMember(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('leadId', ParseUUIDPipe) leadId: string,
  ) {
    return this.segments.removeMember(user.orgId, id, leadId);
  }
}
