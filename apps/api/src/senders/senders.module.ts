import { Module } from '@nestjs/common';
import { DnsCheckService } from './dns-check.service';
import { ProviderResolver } from './providers/provider.resolver';
import { SendersController } from './senders.controller';
import { SendersService } from './senders.service';

@Module({
  controllers: [SendersController],
  providers: [SendersService, DnsCheckService, ProviderResolver],
  exports: [SendersService],
})
export class SendersModule {}
