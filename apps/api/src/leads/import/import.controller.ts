import {
  BadRequestException,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Body } from '@nestjs/common';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import type { AuthUser } from '../../auth/types';
import type { ImportableField } from './import.dto';
import { ImportService } from './import.service';
import { Roles } from '../../auth/decorators/roles.decorator';
import { Throttle } from '@nestjs/throttler';

interface MulterFile {
  buffer: Buffer;
  size: number;
  mimetype: string;
}

const MAX_BYTES = 5 * 1024 * 1024; // 5 MB

@Controller('leads/import')
export class ImportController {
  constructor(private readonly imports: ImportService) {}

  // Bulk import (up to the plan's lead cap) is a manager action; agents add
  // and edit leads one at a time.
  @Roles('admin', 'manager')
  @Post()
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_BYTES } }))
  start(
    @CurrentUser() user: AuthUser,
    @UploadedFile() file: MulterFile | undefined,
    @Body('mapping') mappingRaw: string,
    @Body('onDuplicate') onDuplicate: string,
  ) {
    if (!file) throw new BadRequestException('CSV file is required');
    let mapping: Record<string, ImportableField>;
    try {
      mapping = JSON.parse(mappingRaw) as Record<string, ImportableField>;
    } catch {
      throw new BadRequestException('mapping must be valid JSON');
    }
    const dup = onDuplicate === 'update' ? 'update' : 'skip';
    return this.imports.start(
      user.orgId,
      file.buffer.toString('utf8'),
      mapping,
      dup,
    );
  }

  /** Column -> field suggestions (AI or rules) from headers + sample rows. */
  @Roles('admin', 'manager')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Post('suggest-mapping')
  @HttpCode(200)
  suggestMapping(
    @CurrentUser() user: AuthUser,
    @Body('headers') headers: unknown,
    @Body('rows') rows: unknown,
  ) {
    return this.imports.suggestMapping(user.orgId, headers, rows);
  }

  @Get(':id')
  status(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.imports.status(user.orgId, id);
  }
}
