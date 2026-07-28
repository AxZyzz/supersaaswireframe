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
import { IsString, MaxLength } from 'class-validator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import type { AuthUser } from '../auth/types';
import { DnsCheckService } from './dns-check.service';
import { CreateSenderDto, TestSendDto, UpdateSenderDto } from './sender.dto';
import { SendersService } from './senders.service';

class DnsQueryDto {
  @IsString() @MaxLength(253) domain!: string;
}

@Controller('senders')
export class SendersController {
  constructor(
    private readonly senders: SendersService,
    private readonly dns: DnsCheckService,
  ) {}

  // Static route before :id.
  @Get('dns-check')
  dnsCheck(@Query() q: DnsQueryDto) {
    return this.dns.check(q.domain);
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
