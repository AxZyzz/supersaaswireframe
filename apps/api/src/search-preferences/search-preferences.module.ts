import { Module } from '@nestjs/common';
import { CampaignsModule } from '../campaigns/campaigns.module';
import { InsightsModule } from '../insights/insights.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { SearchPreferencesController } from './search-preferences.controller';
import { SearchPreferencesService } from './search-preferences.service';

/** Search preferences (Learning Loop T12): who should Discover find more of? */
@Module({
  imports: [InsightsModule, CampaignsModule, NotificationsModule],
  controllers: [SearchPreferencesController],
  providers: [SearchPreferencesService],
  exports: [SearchPreferencesService],
})
export class SearchPreferencesModule {}
