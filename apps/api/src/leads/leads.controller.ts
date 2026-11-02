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
  Query,
} from '@nestjs/common';
import Papa from 'papaparse';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import type { AuthUser } from '../auth/types';
import {
  AttachTagDto,
  CreateLeadDto,
  CreateNoteDto,
  ListLeadsQuery,
  MergeLeadsDto,
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

  // Static sub-routes must precede :id — the words aren't UUIDs.
  @Get('duplicates')
  duplicates(@CurrentUser() user: AuthUser) {
    return this.leads.duplicates(user.orgId);
  }

  @Roles('admin', 'manager')
  @HttpCode(200)
  @Post('merge')
  merge(@CurrentUser() user: AuthUser, @Body() dto: MergeLeadsDto) {
    return this.leads.merge(user.orgId, dto.primaryId, dto.mergeIds);
  }

  // Must precede :id — 'export' is not a UUID and would 400 on that route.
  @Get('export')
  @Header('Content-Type', 'text/csv')
  @Header('Content-Disposition', 'attachment; filename="leads.csv"')
  async export(@CurrentUser() user: AuthUser, @Query() q: ListLeadsQuery) {
    const rows = await this.leads.exportRows(user.orgId, q);
    return Papa.unparse(
      rows.map((r) => ({
        email: r.email ?? '',
        first_name: r.first_name ?? '',
        last_name: r.last_name ?? '',
        company: r.company ?? '',
        title: r.title ?? '',
        phone: r.phone ?? '',
        status: r.status,
        score: r.score ?? '',
        source: r.source ?? '',
        created_at: r.created_at.toISOString(),
      })),
      {
        columns: [
          'email',
          'first_name',
          'last_name',
          'company',
          'title',
          'phone',
          'status',
          'score',
          'source',
          'created_at',
        ],
      },
    );
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
    @Query('forget') forget?: string,
  ) {
    return this.leads.remove(user.orgId, id, forget === 'true');
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
