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
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import type { AuthUser } from '../auth/types';
import {
  AttachTagDto,
  CreateLeadDto,
  CreateNoteDto,
  ListLeadsQuery,
  UpdateLeadDto,
} from './dto/lead.dto';
import { LeadsService } from './leads.service';
import { TagsService } from './tags.service';

@Controller('leads')
export class LeadsController {
  constructor(
    private readonly leads: LeadsService,
    private readonly tags: TagsService,
  ) {}

  @Get()
  list(@CurrentUser() user: AuthUser, @Query() q: ListLeadsQuery) {
    return this.leads.list(user.orgId, q);
  }

  @Post()
  @HttpCode(201)
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateLeadDto) {
    return this.leads.create(user.orgId, dto);
  }

  @Get(':id')
  findOne(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.leads.findOne(user.orgId, id);
  }

  @Patch(':id')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateLeadDto,
  ) {
    return this.leads.update(user.orgId, id, dto);
  }

  // Agents can view/edit leads but not delete them.
  @Roles('admin', 'manager')
  @Delete(':id')
  remove(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.leads.remove(user.orgId, id);
  }

  @Post(':id/notes')
  @HttpCode(201)
  addNote(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateNoteDto,
  ) {
    return this.leads.addNote(user.orgId, id, user.userId, dto);
  }

  @Post(':id/tags')
  @HttpCode(200)
  attachTag(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AttachTagDto,
  ) {
    return this.tags.attach(user.orgId, id, dto.tagId);
  }

  @Delete(':id/tags/:tagId')
  detachTag(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('tagId', ParseUUIDPipe) tagId: string,
  ) {
    return this.tags.detach(user.orgId, id, tagId);
  }
}
