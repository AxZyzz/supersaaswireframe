import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { AppService, Readiness } from './app.service';
import { Public } from './auth/decorators/public.decorator';

@Public()
@SkipThrottle()
@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  /** Liveness: the process is up. */
  @Get()
  health(): { status: string } {
    return this.appService.health();
  }

  /** Readiness: DB + Redis reachable. 503 so load balancers pull the node. */
  @Get('health/ready')
  async ready(): Promise<Readiness> {
    const r = await this.appService.ready();
    if (r.status !== 'ok') throw new ServiceUnavailableException(r);
    return r;
  }
}
