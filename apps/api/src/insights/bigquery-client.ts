import type { BigQuery } from '@google-cloud/bigquery';
import type { BigQueryRunner } from './bigquery-insights.source';

/**
 * The real BigQuery client, loaded the first time a query runs (not at boot),
 * so a workspace on INSIGHTS_SOURCE=postgres never pays for loading it.
 * Auth is Application Default Credentials: the Cloud Run service account in
 * prod, `gcloud auth application-default login` on a laptop.
 */
export class LazyBigQueryRunner implements BigQueryRunner {
  private client?: Promise<BigQuery>;

  constructor(
    private readonly project: string,
    private readonly location: string,
  ) {}

  async query(options: Parameters<BigQueryRunner['query']>[0]) {
    this.client ??= import('@google-cloud/bigquery').then(
      ({ BigQuery: Client }) =>
        new Client({ projectId: this.project, location: this.location }),
    );
    const client = await this.client;
    return client.query(options) as Promise<
      [Array<Record<string, unknown>>, ...unknown[]]
    >;
  }
}
