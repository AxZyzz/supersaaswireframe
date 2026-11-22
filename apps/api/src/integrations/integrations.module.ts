import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { LeadsModule } from '../leads/leads.module';
import { OutcomesModule } from '../outcomes/outcomes.module';
import { SendersModule } from '../senders/senders.module';
import { CalendarOAuthService } from './calendar-oauth.service';
import { CalendarSyncService } from './calendar-sync.service';
import { GoogleOAuthController } from './google-oauth.controller';
import {
  IntegrationsController,
  SheetSyncsController,
} from './integrations.controller';
import { IntegrationsService } from './integrations.service';
import { SheetsOAuthService } from './sheets-oauth.service';
import { SheetsService } from './sheets.service';

/** Settings → Integrations (T9.2), Google Sheets sync (T2.8), Google Calendar
 *  booked calls (T16), and the shared Google OAuth callback (routes to Gmail,
 *  Sheets or Calendar by signed state). */
@Module({
  imports: [AuthModule, SendersModule, LeadsModule, OutcomesModule],
  controllers: [
    IntegrationsController,
    SheetSyncsController,
    GoogleOAuthController,
  ],
  providers: [
    IntegrationsService,
    SheetsOAuthService,
    SheetsService,
    CalendarOAuthService,
    CalendarSyncService,
  ],
  exports: [SheetsService, CalendarSyncService],
})
export class IntegrationsModule {}
