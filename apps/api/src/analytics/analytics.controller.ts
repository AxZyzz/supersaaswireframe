import { Controller, Get } from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthUser } from '../auth/types';
import { AnalyticsService } from './analytics.service';

@Controller('analytics')
export class AnalyticsController {
  constructor(private readonly analytics: AnalyticsService) {}

  @Get('overview')
  overview(@CurrentUser() user: AuthUser) {
    return this.analytics.overview(user.orgId);
  }

  @Get('campaigns')
  campaigns(@CurrentUser() user: AuthUser) {
    return this.analytics.campaigns(user.orgId);
  }
}
