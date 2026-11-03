import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { IsOptional, IsString, MaxLength } from 'class-validator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import type { AuthUser } from '../auth/types';
import { DnsCheckService } from './dns-check.service';
import { GmailOAuthService } from './gmail-oauth.service';
import { CreateSenderDto, TestSendDto, UpdateSenderDto } from './sender.dto';
import { SendersService } from './senders.service';

class DnsQueryDto {
  @IsString() @MaxLength(253) domain!: string;
}

class GmailConnectDto {
  /** Display name for the new sender; defaults to the mailbox name. */
  @IsOptional() @IsString() @MaxLength(120) fromName?: string;
}

@Controller('senders')
export class SendersController {
  constructor(
    private readonly senders: SendersService,
    private readonly dns: DnsCheckService,
    private readonly gmail: GmailOAuthService,
  ) {}

  // Static route before :id.
  @Get('dns-check')
  dnsCheck(@Query() q: DnsQueryDto) {
    return this.dns.check(q.domain);
  }

  // Gmail (T3.3): whether this server can connect Gmail at all, so the UI can
  // hide the button when GOOGLE_CLIENT_ID/SECRET aren't set.
  @Get('gmail/status')
  gmailStatus() {
    return { enabled: this.gmail.isConfigured() };
  }

  // Returns the Google consent URL; the browser navigates there and Google
  // redirects back to GET /auth/google/callback.
  @Roles('admin', 'manager')
  @Post('gmail/connect')
  @HttpCode(200)
  gmailConnect(@CurrentUser() user: AuthUser, @Body() dto: GmailConnectDto) {
    return this.gmail.connectUrl(user, dto.fromName);
  }

  @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.senders.list(user.orgId);
  }

  @Roles('admin', 'manager')
  @Post()
  @HttpCode(201)
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateSenderDto) {
    return this.senders.create(user.orgId, dto);
  }

  @Get(':id')
  get(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.senders.get(user.orgId, id);
  }

  @Roles('admin', 'manager')
  @Patch(':id')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateSenderDto,
  ) {
    return this.senders.update(user.orgId, id, dto);
  }

  @Roles('admin', 'manager')
  @Delete(':id')
  remove(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.senders.remove(user.orgId, id);
  }

  // Connection/auth check via the provider abstraction; flips status. No send.
  @Roles('admin', 'manager')
  @Post(':id/verify')
  @HttpCode(200)
  verify(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.senders.verify(user.orgId, id);
  }

  // Sends a real test email through the sender's provider.
  @Roles('admin', 'manager')
  @Post(':id/test')
  @HttpCode(200)
  test(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: TestSendDto,
  ) {
    return this.senders.testSend(user.orgId, id, dto.to);
  }
}
