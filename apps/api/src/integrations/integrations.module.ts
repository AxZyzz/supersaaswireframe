import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { LeadsModule } from '../leads/leads.module';
import { SendersModule } from '../senders/senders.module';
import { GoogleOAuthController } from './google-oauth.controller';
import {
  IntegrationsController,
  SheetSyncsController,
} from './integrations.controller';
import { IntegrationsService } from './integrations.service';
import { SheetsOAuthService } from './sheets-oauth.service';
import { SheetsService } from './sheets.service';

/** Settings → Integrations (T9.2), Google Sheets sync (T2.8), and the shared
 *  Google OAuth callback (routes to Gmail or Sheets by signed state). */
@Module({
  imports: [AuthModule, SendersModule, LeadsModule],
  controllers: [
    IntegrationsController,
    SheetSyncsController,
    GoogleOAuthController,
  ],
  providers: [IntegrationsService, SheetsOAuthService, SheetsService],
  exports: [SheetsService],
})
export class IntegrationsModule {}
