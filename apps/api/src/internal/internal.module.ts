import { Module } from '@nestjs/common';
import { LoopHealthModule } from '../loop-health/loop-health.module';
import { ReviewModule } from '../review/review.module';
import { SearchPreferencesModule } from '../search-preferences/search-preferences.module';
import {
  CRON_TOKEN_VERIFIER,
  CronAuthGuard,
  GoogleCronTokenVerifier,
} from './cron-auth.guard';
import { CronController } from './cron.controller';
import { WeeklyReviewService } from './weekly-review.service';

/** Scheduled jobs for Cloud Scheduler (Learning Loop T13). */
@Module({
  imports: [LoopHealthModule, ReviewModule, SearchPreferencesModule],
  controllers: [CronController],
  providers: [
    CronAuthGuard,
    { provide: CRON_TOKEN_VERIFIER, useClass: GoogleCronTokenVerifier },
    WeeklyReviewService,
  ],
  exports: [WeeklyReviewService],
})
export class InternalModule {}
