import { Global, Module } from '@nestjs/common';
import { SystemMailService } from './system-mail.service';

/** Global so any feature can send platform email (resets, notifications). */
@Global()
@Module({
  providers: [SystemMailService],
  exports: [SystemMailService],
})
export class MailModule {}
