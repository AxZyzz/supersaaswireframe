import {
  BadRequestException,
  Controller,
  Get,
  Header,
  Param,
  ParseUUIDPipe,
  Query,
} from '@nestjs/common';
import { IsISO8601, IsOptional } from 'class-validator';
import Papa from 'papaparse';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthUser } from '../auth/types';
import { AnalyticsService, DateRange } from './analytics.service';

/** ?from=…&to=… — ISO dates/datetimes; `to` is exclusive. Both optional. */
class RangeQuery {
  @IsOptional() @IsISO8601() from?: string;
  @IsOptional() @IsISO8601() to?: string;
}

function toRange(q: RangeQuery): DateRange {
  const range = {
    from: q.from ? new Date(q.from) : null,
    to: q.to ? new Date(q.to) : null,
  };
  if (range.from && range.to && range.from >= range.to) {
    throw new BadRequestException('`from` must be before `to`');
  }
  return range;
}

const pct = (n: number, d: number) => (d ? ((n / d) * 100).toFixed(1) : '0.0');

@Controller('analytics')
export class AnalyticsController {
  constructor(private readonly analytics: AnalyticsService) {}

  @Get('overview')
  overview(@CurrentUser() user: AuthUser, @Query() q: RangeQuery) {
    return this.analytics.overview(user.orgId, toRange(q));
  }

  @Get('campaigns')
  campaigns(@CurrentUser() user: AuthUser, @Query() q: RangeQuery) {
    return this.analytics.campaigns(user.orgId, toRange(q));
  }

  /** Campaign report as CSV (same window + numbers as the table). */
  @Get('campaigns/export')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Content-Disposition', 'attachment; filename="campaign-report.csv"')
  async exportCampaigns(@CurrentUser() user: AuthUser, @Query() q: RangeQuery) {
    const rows = await this.analytics.campaigns(user.orgId, toRange(q));
    return Papa.unparse(
      rows.map((r) => ({
        campaign: r.name,
        status: r.status,
        enrolled: r.enrolled,
        sent: r.sent,
        opened: r.opened,
        open_rate_pct: pct(r.opened, r.sent),
        clicked: r.clicked,
        click_rate_pct: pct(r.clicked, r.sent),
        replied: r.replied,
        reply_rate_pct: pct(r.replied, r.sent),
        unsubscribed: r.unsubscribed,
      })),
      // campaign names are user input — never let them run as formulas
      { escapeFormulae: true },
    );
  }

  @Get('campaigns/:id/steps')
  steps(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.analytics.steps(user.orgId, id);
  }
}
