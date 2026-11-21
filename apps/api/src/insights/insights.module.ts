import { Logger, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { LazyBigQueryRunner } from './bigquery-client';
import {
  BigQueryInsightsSource,
  DEFAULT_BQ_DATASET,
  DEFAULT_BQ_MAX_BYTES,
  FallbackInsightsSource,
} from './bigquery-insights.source';
import { InsightsController } from './insights.controller';
import { INSIGHTS_SOURCE, InsightsService } from './insights.service';
import { PostgresInsightsSource } from './postgres-insights.source';
import { PostgresSideData } from './postgres-side-data';
import type { InsightsSource } from './types';

/**
 * Insights (Learning Loop T06/T07). INSIGHTS_SOURCE picks where numbers come
 * from: `postgres` (default, live) or `bigquery` (the Datastream copy, with a
 * "data as of" time). Both return the same row shapes (see source-contract.ts).
 * If BigQuery fails, the page is answered from Postgres and the failure is logged.
 */
@Module({
  controllers: [InsightsController],
  providers: [
    PostgresInsightsSource,
    PostgresSideData,
    {
      provide: INSIGHTS_SOURCE,
      inject: [ConfigService, PostgresInsightsSource, PostgresSideData],
      useFactory: (
        config: ConfigService,
        pg: PostgresInsightsSource,
        side: PostgresSideData,
      ): InsightsSource => {
        const which = (
          config.get<string>('INSIGHTS_SOURCE') ?? 'postgres'
        ).toLowerCase();
        if (which !== 'bigquery') return pg;

        const project =
          config.get<string>('BIGQUERY_PROJECT') ||
          config.get<string>('GOOGLE_CLOUD_PROJECT') ||
          '';
        const location =
          config.get<string>('BIGQUERY_LOCATION') || 'asia-south1';
        new Logger('InsightsModule').log(
          `Insights read from BigQuery (${project}.${config.get<string>('BIGQUERY_DATASET') || DEFAULT_BQ_DATASET}, ${location}); Postgres answers if it fails`,
        );
        return new FallbackInsightsSource(
          new BigQueryInsightsSource(
            new LazyBigQueryRunner(project, location),
            side,
            {
              project,
              dataset:
                config.get<string>('BIGQUERY_DATASET') || DEFAULT_BQ_DATASET,
              location,
              maxBytesBilled:
                Number(config.get<string>('BIGQUERY_MAX_BYTES')) ||
                DEFAULT_BQ_MAX_BYTES,
            },
          ),
          pg,
        );
      },
    },
    InsightsService,
  ],
  exports: [InsightsService],
})
export class InsightsModule {}
