import { Body, Controller, Get, HttpCode, Param, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Public } from '../auth/decorators/public.decorator';
import type { AuthUser } from '../auth/types';
import { RegisterInviteDto } from './team.dto';
import { TeamService } from './team.service';

/** Invitee side of team invites, addressed by the secret link token. */
@Controller('invites')
export class InvitesController {
  constructor(private readonly team: TeamService) {}

  @Public()
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Get(':token')
  preview(@Param('token') token: string) {
    return this.team.preview(token);
  }

  /** Existing account, signed in with the invited email. */
  @Post(':token/accept')
  @HttpCode(200)
  accept(@CurrentUser() user: AuthUser, @Param('token') token: string) {
    return this.team.accept(token, user.userId);
  }

  /** New account created from the invite. */
  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post(':token/register')
  @HttpCode(201)
  register(@Param('token') token: string, @Body() dto: RegisterInviteDto) {
    return this.team.register(token, dto.name, dto.password);
  }
}
