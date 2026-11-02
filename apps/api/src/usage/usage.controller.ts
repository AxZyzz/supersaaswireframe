import { Controller, Get } from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthUser } from '../auth/types';
import { UsageService } from './usage.service';

@Controller('usage')
export class UsageController {
  constructor(private readonly usage: UsageService) {}

  /** Plan + current usage for every limited resource (all members). */
  @Get()
  summary(@CurrentUser() user: AuthUser) {
    return this.usage.summary(user.orgId);
  }
}
