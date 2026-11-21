import { Controller, HttpCode, Post, UseGuards } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { Public } from '../auth/decorators/public.decorator';
import { LoopHealthService } from '../loop-health/loop-health.service';
import { SearchPreferencesService } from '../search-preferences/search-preferences.service';
import { withSpan } from '../tracing/spans';
import { CronAuthGuard } from './cron-auth.guard';
import { WeeklyReviewService } from './weekly-review.service';

/**
 * The scheduled jobs (Learning Loop T13), called by Cloud Scheduler. They are
 * "public" only in the sense that the normal user login does not apply: the
 * CronAuthGuard accepts nothing but the scheduler's signed token.
 */
@Public()
@SkipThrottle()
@UseGuards(CronAuthGuard)
@Controller('internal/cron')
export class CronController {
  constructor(
    private readonly weekly: WeeklyReviewService,
    private readonly prefs: SearchPreferencesService,
    private readonly health: LoopHealthService,
  ) {}

  /** Monday 06:00 IST: refresh every workspace's reviews and preference results. */
  @Post('weekly-review')
  @HttpCode(200)
  weeklyReview() {
    return this.weekly.run();
  }

  /** Hourly: end overdue search preferences and switch off unsafe ones. */
  @Post('expire-preferences')
  @HttpCode(200)
  expirePreferences() {
    return withSpan('expire_preferences', () => this.prefs.runDue());
  }

  /** Every 6 hours: one `loop_health` log line per workspace, for the alerts. */
  @Post('loop-health')
  @HttpCode(200)
  loopHealth() {
    return withSpan('loop_health', () => this.health.runAll());
  }
}
