import { Controller, HttpCode, Post } from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import type { AuthUser } from '../auth/types';
import { SendService } from './send.service';

@Controller('sending')
export class SendingController {
  constructor(private readonly send: SendService) {}

  // Manually process this org's due sends now (dev/testing; production also runs
  // a repeatable scheduler). Scoped to the caller's org.
  @Roles('admin', 'manager')
  @Post('tick')
  @HttpCode(200)
  tick(@CurrentUser() user: AuthUser) {
    return this.send.tick(user.orgId);
  }
}
