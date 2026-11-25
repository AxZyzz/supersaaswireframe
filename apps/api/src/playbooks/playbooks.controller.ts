import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import {
  IsInt,
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
import {
  MAX_BODY,
  MAX_TITLE,
  MAX_VALID_DAYS,
  MIN_BODY,
  MIN_TITLE,
} from './playbook.types';
import { PlaybooksService } from './playbooks.service';

/** Which approved result a draft or a playbook comes from: exactly one. */
export class DraftPlaybookDto {
  @IsOptional() @IsUUID() reviewId?: string;
  @IsOptional() @IsUUID() preferenceId?: string;
}

export class CreatePlaybookDto extends DraftPlaybookDto {
  @IsString() @MinLength(MIN_TITLE) @MaxLength(MAX_TITLE) title!: string;
  @IsString() @MinLength(MIN_BODY) @MaxLength(MAX_BODY) body!: string;
  @IsOptional() @IsInt() @Min(1) @Max(MAX_VALID_DAYS) validDays?: number;
}

export class EditPlaybookDto {
  @IsString() @MinLength(MIN_TITLE) @MaxLength(MAX_TITLE) title!: string;
  @IsString() @MinLength(MIN_BODY) @MaxLength(MAX_BODY) body!: string;
  @IsOptional() @IsInt() @Min(1) @Max(MAX_VALID_DAYS) validDays?: number;
}

/**
 * Playbook memory (T14). Everyone in the workspace can read; only admins and
 * managers draft, save, edit or retire (the service checks the role again),
 * and only admins rebuild the vector index.
 */
@Controller('playbooks')
export class PlaybooksController {
  constructor(private readonly playbooks: PlaybooksService) {}

  @Get()
  list(@CurrentUser() user: AuthUser, @Query('offerId') offerId?: string) {
    if (offerId && !/^[0-9a-f-]{36}$/i.test(offerId)) {
      throw new BadRequestException('offerId must be a UUID');
    }
    return this.playbooks.list(user.orgId, { offerId: offerId || undefined });
  }

  @Roles('admin', 'manager')
  @Post('draft')
  @HttpCode(200)
  draft(@CurrentUser() user: AuthUser, @Body() dto: DraftPlaybookDto) {
    if (!!dto.reviewId === !!dto.preferenceId) {
      throw new BadRequestException(
        'Send either reviewId or preferenceId, not both and not neither',
      );
    }
    return dto.reviewId
      ? this.playbooks.draftFromReview(user.orgId, user, dto.reviewId)
      : this.playbooks.draftFromPreference(
          user.orgId,
          user,
          dto.preferenceId as string,
        );
  }

  @Roles('admin')
  @Post('reindex')
  @HttpCode(200)
  reindex(@CurrentUser() user: AuthUser) {
    return this.playbooks.reindex(user.orgId, user);
  }

  @Roles('admin', 'manager')
  @Post()
  create(@CurrentUser() user: AuthUser, @Body() dto: CreatePlaybookDto) {
    return this.playbooks.create(user.orgId, user, dto);
  }

  @Get(':id')
  one(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.playbooks.get(user.orgId, id);
  }

  @Get(':id/versions')
  versions(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.playbooks.versions(user.orgId, id);
  }

  @Roles('admin', 'manager')
  @Patch(':id')
  edit(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: EditPlaybookDto,
  ) {
    return this.playbooks.edit(user.orgId, user, id, dto);
  }

  @Roles('admin', 'manager')
  @Post(':id/retire')
  @HttpCode(200)
  retire(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.playbooks.retire(user.orgId, user, id);
  }
}
