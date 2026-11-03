import { Module } from '@nestjs/common';
import { AnalyticsController } from './analytics.controller';
import { AnalyticsService } from './analytics.service';
import { WeeklySummaryService } from './weekly-summary.service';

// Org-wide analytics (E8). Live-computed over the existing lead/campaign/sending
// tables; no new schema. Also the Monday summary email (T7.5).
@Module({
  controllers: [AnalyticsController],
  providers: [AnalyticsService, WeeklySummaryService],
  exports: [AnalyticsService, WeeklySummaryService],
})
export class AnalyticsModule {}
