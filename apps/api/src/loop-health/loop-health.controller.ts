import { Controller, Get } from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthUser } from '../auth/types';
import { LoopHealthService } from './loop-health.service';

/** Loop health (T13): the counts behind the strip at the top of the Review pages. Everyone can read. */
@Controller('review')
export class LoopHealthController {
  constructor(private readonly health: LoopHealthService) {}

  @Get('health')
  get(@CurrentUser() user: AuthUser) {
    return this.health.compute(user.orgId);
  }
}
