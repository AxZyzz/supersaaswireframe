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
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { bindBrowser } from '../google/google-oauth';
import {
  IsBoolean,
  IsIn,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import type { AuthUser } from '../auth/types';
import type { ImportableField } from '../leads/import/import.dto';
import { IntegrationsService } from './integrations.service';
import { SheetsOAuthService } from './sheets-oauth.service';
import { SheetsService } from './sheets.service';

class ConnectDto {
  /** Where Google sends the browser back to: /leads or /settings. */
  @IsOptional() @IsString() @MaxLength(40) returnTo?: string;
}

class PreviewDto {
  @IsString() @MaxLength(500) url!: string;
  @IsOptional() @IsString() @MaxLength(200) sheet?: string;
}

class CreateSyncDto {
  @IsString() @MaxLength(200) spreadsheetId!: string;
  @IsString() @MaxLength(200) sheetTitle!: string;
  // { "Sheet column": "email", ... }; validated against IMPORTABLE_FIELDS
  @IsObject() mapping!: Record<string, ImportableField>;
  @IsOptional() @IsIn(['skip', 'update']) onDuplicate?: 'skip' | 'update';
  /** Re-sync hourly (default) or import once. */
  @IsOptional() @IsBoolean() keepSyncing?: boolean;
}

class UpdateSyncDto {
  @IsBoolean() enabled!: boolean;
}

/** Settings → Integrations (T9.2) + Google Sheets connection (T2.8). */
@Controller('integrations')
export class IntegrationsController {
  constructor(
    private readonly integrations: IntegrationsService,
    private readonly sheetsOAuth: SheetsOAuthService,
    private readonly sheets: SheetsService,
  ) {}

  @Get()
  overview(@CurrentUser() user: AuthUser) {
    return this.integrations.overview(user.orgId);
  }

  @Roles('admin', 'manager')
  @Post('google-sheets/connect')
  @HttpCode(200)
  connectSheets(
    @CurrentUser() user: AuthUser,
    @Body() dto: ConnectDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.sheetsOAuth.connectUrl(user, dto.returnTo, bindBrowser(res));
  }

  @Roles('admin', 'manager')
  @Delete('google-sheets')
  disconnectSheets(@CurrentUser() user: AuthUser) {
    return this.integrations.disconnectSheets(user.orgId);
  }

  @Roles('admin', 'manager')
  @Post('google-sheets/preview')
  @HttpCode(200)
  preview(@CurrentUser() user: AuthUser, @Body() dto: PreviewDto) {
    return this.sheets.preview(user.orgId, dto.url, dto.sheet);
  }
}

/** Sheet tabs synced into leads (T2.8). */
@Controller('sheet-syncs')
export class SheetSyncsController {
  constructor(private readonly sheets: SheetsService) {}

  @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.sheets.list(user.orgId);
  }

  @Roles('admin', 'manager')
  @Post()
  @HttpCode(201)
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateSyncDto) {
    return this.sheets.create(user.orgId, user.userId, dto);
  }

  @Roles('admin', 'manager')
  @Post(':id/run')
  @HttpCode(200)
  run(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.sheets.run(user.orgId, id);
  }

  @Roles('admin', 'manager')
  @Patch(':id')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateSyncDto,
  ) {
    return this.sheets.setEnabled(user.orgId, id, dto.enabled);
  }

  @Roles('admin', 'manager')
  @Delete(':id')
  remove(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.sheets.remove(user.orgId, id);
  }
}
