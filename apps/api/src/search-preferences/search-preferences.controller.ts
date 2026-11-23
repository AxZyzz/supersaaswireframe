import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsDateString,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import type { AuthUser } from '../auth/types';
import { SearchPreferencesService } from './search-preferences.service';

/** Which Insights headline the preference comes from, and the filters that produced it. */
export class ProposeDto {
  @IsOptional() @IsUUID() offerId?: string;
  @IsString() @MinLength(3) @MaxLength(300) insightId!: string;
  @IsOptional()
  @IsArray()
  @IsUUID('all', { each: true })
  campaignIds?: string[];
  @IsOptional() @IsDateString() from?: string;
  @IsOptional() @IsDateString() to?: string;
}

export class CreatePreferenceDto extends ProposeDto {
  /** The hash of the preview the manager looked at. */
  @IsString() @MinLength(16) @MaxLength(100) proposalHash!: string;
  /** Made when the approval dialog opens; a repeat of it is a no-op. */
  @IsString() @MinLength(8) @MaxLength(100) idempotencyKey!: string;
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0.01)
  @Max(1)
  capShare?: number;
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(365)
  expiresInDays?: number;
}

export class EndPreferenceDto {
  @IsOptional() @IsString() @MaxLength(500) reason?: string;
}

const dates = (d: { from?: string; to?: string }) => ({
  from: d.from ? new Date(d.from) : undefined,
  to: d.to ? new Date(d.to) : undefined,
});

/**
 * Search preferences (T12). Everyone can read; only admins and managers
 * propose, approve, withdraw or revert (the service checks the role again).
 */
@Controller('search-preferences')
export class SearchPreferencesController {
  constructor(private readonly prefs: SearchPreferencesService) {}

  @Get()
  list(@CurrentUser() user: AuthUser, @Query('offerId') offerId?: string) {
    if (offerId && !/^[0-9a-f-]{36}$/i.test(offerId)) {
      throw new BadRequestException('offerId must be a UUID');
    }
    return this.prefs.list(user.orgId, offerId || undefined);
  }

  // Reads the evidence (BigQuery when it is on) without storing anything; a
  // person previews a few times, so 20/min is plenty (security review T18, finding 2).
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Roles('admin', 'manager')
  @Post('propose')
  @HttpCode(200)
  propose(@CurrentUser() user: AuthUser, @Body() dto: ProposeDto) {
    return this.prefs.propose(user.orgId, { ...dto, ...dates(dto) });
  }

  @Roles('admin', 'manager')
  @Post()
  @HttpCode(200)
  create(@CurrentUser() user: AuthUser, @Body() dto: CreatePreferenceDto) {
    return this.prefs.create(user.orgId, user, { ...dto, ...dates(dto) });
  }

  @Get(':id')
  one(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.prefs.get(user.orgId, id);
  }

  @Get(':id/results')
  results(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.prefs.results(user.orgId, id);
  }

  @Roles('admin', 'manager')
  @Post(':id/withdraw')
  @HttpCode(200)
  withdraw(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: EndPreferenceDto,
  ) {
    return this.prefs.withdraw(user.orgId, user, id, dto.reason);
  }

  @Roles('admin', 'manager')
  @Post(':id/revert')
  @HttpCode(200)
  revert(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: EndPreferenceDto,
  ) {
    return this.prefs.revert(user.orgId, user, id, dto.reason);
  }
}
