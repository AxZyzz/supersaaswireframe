import { Module } from '@nestjs/common';
import { DnsCheckService } from './dns-check.service';
import { SendersController } from './senders.controller';
import { SendersService } from './senders.service';

@Module({
  controllers: [SendersController],
  providers: [SendersService, DnsCheckService],
})
export class SendersModule {}
