import { Controller, Get, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { Public } from '../auth/decorators/public.decorator';
import { stateType } from '../google/google-oauth';
import { GmailOAuthService } from '../senders/gmail-oauth.service';
import { SheetsOAuthService } from './sheets-oauth.service';

/**
 * Google redirects the browser here after consent, for every "Connect with
 * Google" flow (one registered redirect URI). Public because it's a top-level
 * browser navigation with no Bearer token; the signed `state` carries the
 * workspace and which flow it is. Each flow verifies the state itself.
 * Always ends with a redirect back into the app.
 */
@Controller('auth/google')
export class GoogleOAuthController {
  constructor(
    private readonly gmail: GmailOAuthService,
    private readonly sheets: SheetsOAuthService,
  ) {}

  @Public()
  @Get('callback')
  async callback(
    @Query('code') code: string | undefined,
    @Query('state') state: string | undefined,
    @Query('error') error: string | undefined,
    @Res() res: Response,
  ) {
    const q = { code, state, error };
    const next =
      stateType(state) === 'sheets-connect'
        ? await this.sheets.handleCallback(q)
        : await this.gmail.handleCallback(q);
    res.redirect(302, next);
  }
}
