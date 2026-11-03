import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { DnsCheckService } from './dns-check.service';
import { GmailOAuthService } from './gmail-oauth.service';
import { GoogleOAuthController } from './google-oauth.controller';
import { ProviderResolver } from './providers/provider.resolver';
import { SendersController } from './senders.controller';
import { SendersService } from './senders.service';

@Module({
  imports: [AuthModule],
  controllers: [SendersController, GoogleOAuthController],
  providers: [
    SendersService,
    DnsCheckService,
    ProviderResolver,
    GmailOAuthService,
  ],
  exports: [SendersService],
})
export class SendersModule {}
