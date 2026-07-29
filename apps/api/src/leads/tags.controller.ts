import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import type { AuthUser } from '../auth/types';
import { BulkTagDto, CreateTagDto } from './dto/lead.dto';
import { TagsService } from './tags.service';

@Controller('tags')
export class TagsController {
  constructor(private readonly tags: TagsService) {}

  @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.tags.list(user.orgId);
  }

  @Post()
  @HttpCode(201)
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateTagDto) {
    return this.tags.create(user.orgId, dto);
  }

  // Static route — declared before the ':id' param route.
  @Post('bulk')
  @HttpCode(200)
  bulk(@CurrentUser() user: AuthUser, @Body() dto: BulkTagDto) {
    return this.tags.bulk(user.orgId, dto.leadIds, dto.tagId, dto.action);
  }

  @Roles('admin', 'manager')
  @Delete(':id')
  remove(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.tags.remove(user.orgId, id);
  }
}
