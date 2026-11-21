import { Module, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InsightsController } from './insights.controller';
import { INSIGHTS_SOURCE, InsightsService } from './insights.service';
import { PostgresInsightsSource } from './postgres-insights.source';
import type { InsightsSource } from './types';

/**
 * Insights (Learning Loop T06). INSIGHTS_SOURCE picks where numbers come from:
 * `postgres` (default) now; `bigquery` arrives with T07 and returns the same
 * row shapes (see source-contract.ts).
 */
@Module({
  controllers: [InsightsController],
  providers: [
    PostgresInsightsSource,
    {
      provide: INSIGHTS_SOURCE,
      inject: [ConfigService, PostgresInsightsSource],
      useFactory: (
        config: ConfigService,
        pg: PostgresInsightsSource,
      ): InsightsSource => {
        const which = (
          config.get<string>('INSIGHTS_SOURCE') ?? 'postgres'
        ).toLowerCase();
        if (which === 'bigquery') {
          // T07 swaps this for BigQueryInsightsSource; until then fail loudly
          const nope = () => {
            throw new ServiceUnavailableException(
              'The BigQuery insights source is not available yet (arrives with T07). Set INSIGHTS_SOURCE=postgres.',
            );
          };
          return {
            name: 'bigquery',
            factorFunnel: nope,
            sendTimeGrid: nope,
            all: nope,
          };
        }
        return pg;
      },
    },
    InsightsService,
  ],
  exports: [InsightsService],
})
export class InsightsModule {}
