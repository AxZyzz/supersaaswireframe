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
import {
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { Roles } from '../../auth/decorators/roles.decorator';
import type { AuthUser } from '../../auth/types';
import { ApiKeysService } from './api-keys.service';

class CreateApiKeyDto {
  @IsString() @MaxLength(80) name!: string;
  @IsOptional() @IsInt() @Min(1) @Max(6000) rateLimitPerMin?: number;
}

class UpdateApiKeyDto {
  @IsInt() @Min(1) @Max(6000) rateLimitPerMin!: number;
}

// JWT-protected key management (admin/manager). The raw key is returned once,
// on create, and never again.
@Roles('admin', 'manager')
@Controller('api-keys')
export class ApiKeysController {
  constructor(private readonly keys: ApiKeysService) {}

  @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.keys.list(user.orgId);
  }

  @Post()
  @HttpCode(201)
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateApiKeyDto) {
    return this.keys.create(user.orgId, dto.name, dto.rateLimitPerMin);
  }

  /** Change a key's requests-per-minute budget (T2.9). */
  @Patch(':id')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateApiKeyDto,
  ) {
    return this.keys.setRateLimit(user.orgId, id, dto.rateLimitPerMin);
  }

  @Delete(':id')
  revoke(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.keys.revoke(user.orgId, id);
  }
}
