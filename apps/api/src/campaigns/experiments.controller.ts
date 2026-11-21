import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import type { AuthUser } from '../auth/types';
import { ExperimentsService, UpdateExperimentDto } from './experiments.service';

@Controller('experiments')
export class ExperimentsController {
  constructor(private readonly experiments: ExperimentsService) {}

  @Get(':id')
  get(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.experiments.get(user.orgId, id);
  }

  @Roles('admin', 'manager')
  @Patch(':id')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateExperimentDto,
  ) {
    return this.experiments.update(user.orgId, id, dto);
  }

  @Roles('admin', 'manager')
  @Post(':id/start')
  @HttpCode(200)
  start(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.experiments.start(user.orgId, id);
  }

  @Roles('admin', 'manager')
  @Post(':id/stop')
  @HttpCode(200)
  stop(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.experiments.stop(user.orgId, id);
  }
}
