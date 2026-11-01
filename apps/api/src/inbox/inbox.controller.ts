import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import type { AuthUser } from '../auth/types';
import {
  AddNoteDto,
  SimulateReplyDto,
  UpdateConversationDto,
} from './inbox.dto';
import { InboxService } from './inbox.service';

@Controller('inbox')
export class InboxController {
  constructor(
    private readonly inbox: InboxService,
    private readonly config: ConfigService,
  ) {}

  @Get()
  list(
    @CurrentUser() user: AuthUser,
    @Query('filter') filter?: string,
    @Query('status') status?: string,
    @Query('q') q?: string,
  ) {
    return this.inbox.list(user.orgId, { filter, status, q });
  }

  // Declared before ':id' so it isn't captured as an id.
  @Get('unread-count')
  unreadCount(@CurrentUser() user: AuthUser) {
    return this.inbox.unreadCount(user.orgId);
  }

  @Get(':id')
  get(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.inbox.get(user.orgId, id);
  }

  @Patch(':id')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateConversationDto,
  ) {
    return this.inbox.update(user.orgId, id, dto, user.userId);
  }

  @Post(':id/notes')
  @HttpCode(201)
  addNote(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AddNoteDto,
  ) {
    return this.inbox.addNote(user.orgId, user.userId, id, dto.body);
  }

  // Disabled in production unless INBOX_SIMULATE=on.
  @Roles('admin', 'manager')
  @Post('simulate-reply')
  @HttpCode(201)
  simulate(@CurrentUser() user: AuthUser, @Body() dto: SimulateReplyDto) {
    const prod = this.config.get<string>('NODE_ENV') === 'production';
    if (prod && this.config.get<string>('INBOX_SIMULATE') !== 'on') {
      throw new ForbiddenException('Reply simulation is disabled');
    }
    return this.inbox.ingestReply(user.orgId, dto);
  }
}
