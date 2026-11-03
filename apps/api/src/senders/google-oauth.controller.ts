import { Controller, Get, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { Public } from '../auth/decorators/public.decorator';
import { GmailOAuthService } from './gmail-oauth.service';

/**
 * Google redirects the browser here after consent (T3.3). Public because it's
 * a top-level browser navigation with no Bearer token; the signed `state`
 * carries the workspace. Always ends with a redirect back to Settings.
 */
@Controller('auth/google')
export class GoogleOAuthController {
  constructor(private readonly gmail: GmailOAuthService) {}

  @Public()
  @Get('callback')
  async callback(
    @Query('code') code: string | undefined,
    @Query('state') state: string | undefined,
    @Query('error') error: string | undefined,
    @Res() res: Response,
  ) {
    const next = await this.gmail.handleCallback({ code, state, error });
    res.redirect(302, next);
  }
}
