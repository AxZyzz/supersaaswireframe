import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Post,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { Throttle } from '@nestjs/throttler';
import { AuthService } from './auth.service';
import { CurrentUser } from './decorators/current-user.decorator';
import { Public } from './decorators/public.decorator';
import {
  DeleteAccountDto,
  ForgotPasswordDto,
  LoginDto,
  ResetPasswordDto,
  SignupDto,
  SwitchOrgDto,
} from './dto/auth.dto';
import {
  assertCsrfHeader,
  clearRefreshCookie,
  readRefreshCookie,
} from './refresh-cookie';
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
  refresh(@Req() req: Request) {
    // Rotated token goes back out via RefreshCookieInterceptor. A failed
    // refresh leaves the cookie alone: in a two-tab race the browser may
    // already hold the newer token another tab just received.
    assertCsrfHeader(req);
    const token = readRefreshCookie(req);
    if (!token) throw new UnauthorizedException('No session');
    return this.auth.refresh(token);
  }

  // Password reset (T1.3). Same answer whether or not the email has an
  // account; tight per-IP limits since each call can send an email.
  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @HttpCode(200)
  @Post('forgot-password')
  forgotPassword(@Body() dto: ForgotPasswordDto) {
    return this.auth.requestPasswordReset(dto.email);
  }

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @HttpCode(200)
  @Post('reset-password')
  resetPassword(@Body() dto: ResetPasswordDto) {
    return this.auth.resetPassword(dto.token, dto.password);
  }

  @Public()
  @HttpCode(204)
  @Post('logout')
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    assertCsrfHeader(req);
    const token = readRefreshCookie(req);
    if (token) await this.auth.logout(token);
    clearRefreshCookie(res);
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
