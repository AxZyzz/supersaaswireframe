import { Body, Controller, Delete, Get, HttpCode, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { AuthService } from './auth.service';
import { CurrentUser } from './decorators/current-user.decorator';
import { Public } from './decorators/public.decorator';
import {
  DeleteAccountDto,
  LoginDto,
  RefreshDto,
  SignupDto,
  SwitchOrgDto,
} from './dto/auth.dto';
import type { AuthUser } from './types';

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('signup')
  signup(@Body() dto: SignupDto) {
    return this.auth.signup(dto);
  }

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @HttpCode(200)
  @Post('login')
  login(@Body() dto: LoginDto) {
    return this.auth.login(dto.email, dto.password);
  }

  @Public()
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @HttpCode(200)
  @Post('refresh')
  refresh(@Body() dto: RefreshDto) {
    return this.auth.refresh(dto.refreshToken);
  }

  @Public()
  @HttpCode(204)
  @Post('logout')
  async logout(@Body() dto: RefreshDto) {
    await this.auth.logout(dto.refreshToken);
  }

  @HttpCode(200)
  @Post('switch-org')
  switchOrg(@CurrentUser() user: AuthUser, @Body() dto: SwitchOrgDto) {
    return this.auth.switchOrg(user.userId, dto.orgId);
  }

  @Get('me')
  async me(@CurrentUser() user: AuthUser) {
    return { ...user, isOperator: await this.auth.isOperator(user.userId) };
  }

  /** Permanently delete your own account (password re-check). */
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Delete('me')
  deleteMe(@CurrentUser() user: AuthUser, @Body() dto: DeleteAccountDto) {
    return this.auth.deleteAccount(user.userId, dto.password);
  }
}
