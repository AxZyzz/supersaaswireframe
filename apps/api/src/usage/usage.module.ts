import { Global, Module } from '@nestjs/common';
import { UsageController } from './usage.controller';
import { UsageService } from './usage.service';

/** Global: limits are enforced from many feature modules. */
@Global()
@Module({
  controllers: [UsageController],
  providers: [UsageService],
  exports: [UsageService],
})
export class UsageModule {}
