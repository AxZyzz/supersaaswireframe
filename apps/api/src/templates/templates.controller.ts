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
import { IsOptional, IsUUID } from 'class-validator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import type { AuthUser } from '../auth/types';
import {
  CreateFolderDto,
  CreateTemplateDto,
  PreviewDto,
  TemplateTestSendDto,
  UpdateTemplateDto,
} from './template.dto';
import { TemplatesService } from './templates.service';

class ListQuery {
  @IsOptional() @IsUUID() folderId?: string;
}

@Controller('templates')
export class TemplatesController {
  constructor(private readonly templates: TemplatesService) {}

  // ── folders (static routes — declared before ':id') ──────────────────
  @Get('folders')
  listFolders(@CurrentUser() user: AuthUser) {
    return this.templates.listFolders(user.orgId);
  }

  @Roles('admin', 'manager')
  @Post('folders')
  @HttpCode(201)
  createFolder(@CurrentUser() user: AuthUser, @Body() dto: CreateFolderDto) {
    return this.templates.createFolder(user.orgId, dto);
  }

  @Roles('admin', 'manager')
  @Delete('folders/:id')
  removeFolder(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.templates.removeFolder(user.orgId, id);
  }

  // ── templates ────────────────────────────────────────────────────────
  @Get()
  list(@CurrentUser() user: AuthUser, @Query() q: ListQuery) {
    return this.templates.list(user.orgId, q.folderId);
  }

  @Post()
  @HttpCode(201)
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateTemplateDto) {
    return this.templates.create(user.orgId, dto);
  }

  @Get(':id')
  get(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.templates.get(user.orgId, id);
  }

  @Patch(':id')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateTemplateDto,
  ) {
    return this.templates.update(user.orgId, id, dto);
  }

  @Roles('admin', 'manager')
  @Delete(':id')
  remove(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.templates.remove(user.orgId, id);
  }

  @Post(':id/duplicate')
  @HttpCode(201)
  duplicate(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.templates.duplicate(user.orgId, id);
  }

  @Post(':id/preview')
  @HttpCode(200)
  preview(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: PreviewDto,
  ) {
    return this.templates.preview(user.orgId, id, dto.leadId);
  }

  @Roles('admin', 'manager')
  @Post(':id/test')
  @HttpCode(200)
  test(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: TemplateTestSendDto,
  ) {
    return this.templates.testSend(user.orgId, id, dto.senderId, dto.to);
  }
}
