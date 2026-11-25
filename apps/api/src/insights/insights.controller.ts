import { BadRequestException, Controller, Get, Query } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthUser } from '../auth/types';
import { InsightsService } from './insights.service';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function date(v: string | undefined, name: string): Date | undefined {
  if (!v) return undefined;
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) {
    throw new BadRequestException(`${name} must be a date`);
  }
  return d;
}

/**
 * Insights (T06): what works, factor by factor. Read-only and exploratory.
 * Every role can view it.
 */
@Controller('insights')
export class InsightsController {
  constructor(private readonly insights: InsightsService) {}

  // With INSIGHTS_SOURCE=bigquery each call can run BigQuery queries (billed per
  // byte scanned), so it has its own limit, below the global 100/min
  // (security review T18, finding 2).
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Get()
  get(
    @CurrentUser() user: AuthUser,
    @Query('offerId') offerId?: string,
    @Query('campaignId') campaignId?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    if (offerId && !UUID.test(offerId)) {
      throw new BadRequestException('offerId must be a UUID');
    }
    const campaignIds = campaignId
      ? campaignId
          .split(',')
          .map((c) => c.trim())
          .filter(Boolean)
      : [];
    if (campaignIds.some((c) => !UUID.test(c))) {
      throw new BadRequestException('campaignId must be one or more UUIDs');
    }
    return this.insights.get(user.orgId, {
      offerId: offerId || undefined,
      campaignIds,
      from: date(from, 'from'),
      to: date(to, 'to'),
    });
  }
}
