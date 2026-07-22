import {
  BadRequestException,
  Controller,
  Get,
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

interface MulterFile {
  buffer: Buffer;
  size: number;
  mimetype: string;
}

const MAX_BYTES = 5 * 1024 * 1024; // 5 MB

@Controller('leads/import')
export class ImportController {
  constructor(private readonly imports: ImportService) {}

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

  @Get(':id')
  status(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.imports.status(user.orgId, id);
  }
}
