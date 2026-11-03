import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
} from '@nestjs/common';
import { ArrayMaxSize, IsArray, IsIn } from 'class-validator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthUser } from '../auth/types';
import {
  EMAIL_NOTIFICATION_TYPES,
  NOTIFICATION_TYPES,
  NotificationsService,
} from './notifications.service';

class PreferencesDto {
  @IsArray()
  @ArrayMaxSize(20)
  @IsIn(Object.keys(NOTIFICATION_TYPES), { each: true })
  muted!: string[];
}

class EmailPreferencesDto {
  @IsArray()
  @ArrayMaxSize(20)
  @IsIn(Object.keys(EMAIL_NOTIFICATION_TYPES), { each: true })
  muted!: string[];
}

@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.notifications.list(user.orgId, user.userId);
  }

  /** Per-member, per-workspace mute settings. */
  @Get('preferences')
  preferences(@CurrentUser() user: AuthUser) {
    return this.notifications.preferences(user.orgId, user.userId);
  }

  @Put('preferences')
  setPreferences(@CurrentUser() user: AuthUser, @Body() dto: PreferencesDto) {
    return this.notifications.setPreferences(
      user.orgId,
      user.userId,
      dto.muted,
    );
  }

  // Email channel (T7.5): which notification types (and the weekly summary)
  // this member also gets by email in this workspace.
  @Get('email-preferences')
  emailPreferences(@CurrentUser() user: AuthUser) {
    return this.notifications.emailPreferences(user.orgId, user.userId);
  }

  @Put('email-preferences')
  setEmailPreferences(
    @CurrentUser() user: AuthUser,
    @Body() dto: EmailPreferencesDto,
  ) {
    return this.notifications.setEmailPreferences(
      user.orgId,
      user.userId,
      dto.muted,
    );
  }

  @Get('unread-count')
  unreadCount(@CurrentUser() user: AuthUser) {
    return this.notifications.unreadCount(user.orgId, user.userId);
  }

  @Post('read-all')
  @HttpCode(200)
  readAll(@CurrentUser() user: AuthUser) {
    return this.notifications.markAllRead(user.orgId, user.userId);
  }

  @Post(':id/read')
  @HttpCode(200)
  read(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.notifications.markRead(user.orgId, user.userId, id);
  }
}
