import { Logger, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Pool } from 'pg';
import { AiModule } from '../ai/ai.module';
import { PG_POOL } from '../db/db.module';
import { LazyBigQueryRunner } from '../insights/bigquery-client';
import { DEFAULT_BQ_MAX_BYTES } from '../insights/bigquery-insights.source';
import {
  EMBEDDING_PROVIDER,
  GeminiEmbeddingProvider,
  MockEmbeddingProvider,
  type EmbeddingProvider,
} from './embedding.provider';
import { candidateLoader } from './playbook-candidates';
import { PlaybookDrafter } from './playbook-drafter';
import {
  FallbackRetriever,
  KeywordRetriever,
  VectorRetriever,
  type PlaybookRetriever,
} from './playbook-retriever';
import { PlaybooksController } from './playbooks.controller';
import { PLAYBOOK_RETRIEVER, PlaybooksService } from './playbooks.service';
import {
  BigQueryPlaybookVectorStore,
  DEFAULT_MEMORY_DATASET,
  NoopVectorStore,
  PLAYBOOK_VECTOR_STORE,
  type PlaybookVectorStore,
} from './vector-store';

const searchMode = (config: ConfigService): 'bigquery' | 'postgres' =>
  (config.get<string>('PLAYBOOK_SEARCH') ?? 'postgres').toLowerCase() ===
  'bigquery'
    ? 'bigquery'
    : 'postgres';

/**
 * Playbook memory (Learning Loop T14). PLAYBOOK_SEARCH picks how playbooks
 * are found: `postgres` (default: keyword match, no cloud calls) or
 * `bigquery` (embeddings + VECTOR_SEARCH, keyword match if BigQuery fails).
 * The text always stays in Postgres.
 */
@Module({
  imports: [AiModule],
  controllers: [PlaybooksController],
  providers: [
    {
      // EMBEDDING_DRIVER=gemini|mock. Default: gemini when the AI driver is gemini, else mock.
      provide: EMBEDDING_PROVIDER,
      inject: [ConfigService],
      useFactory: (config: ConfigService): EmbeddingProvider => {
        const driver = (
          config.get<string>('EMBEDDING_DRIVER') ||
          (config.get<string>('AI_DRIVER') === 'gemini' ? 'gemini' : 'mock')
        ).toLowerCase();
        return driver === 'gemini'
          ? new GeminiEmbeddingProvider(config)
          : new MockEmbeddingProvider();
      },
    },
    {
      provide: PLAYBOOK_VECTOR_STORE,
      inject: [ConfigService],
      useFactory: (config: ConfigService): PlaybookVectorStore => {
        if (searchMode(config) !== 'bigquery') return new NoopVectorStore();
        const project =
          config.get<string>('BIGQUERY_PROJECT') ||
          config.get<string>('GOOGLE_CLOUD_PROJECT') ||
          '';
        const location =
          config.get<string>('BIGQUERY_LOCATION') || 'asia-south1';
        const dataset =
          config.get<string>('BIGQUERY_MEMORY_DATASET') ||
          DEFAULT_MEMORY_DATASET;
        new Logger('PlaybooksModule').log(
          `Playbook vectors in BigQuery (${project}.${dataset}, ${location}); keywords answer if it fails`,
        );
        return new BigQueryPlaybookVectorStore(
          new LazyBigQueryRunner(project, location),
          {
            project,
            dataset,
            location,
            maxBytesBilled:
              Number(config.get<string>('BIGQUERY_MAX_BYTES')) ||
              DEFAULT_BQ_MAX_BYTES,
          },
        );
      },
    },
    {
      provide: PLAYBOOK_RETRIEVER,
      inject: [
        ConfigService,
        PG_POOL,
        EMBEDDING_PROVIDER,
        PLAYBOOK_VECTOR_STORE,
      ],
      useFactory: (
        config: ConfigService,
        pool: Pool,
        embeddings: EmbeddingProvider,
        store: PlaybookVectorStore,
      ): PlaybookRetriever => {
        const keywords = new KeywordRetriever(candidateLoader(pool));
        return searchMode(config) === 'bigquery'
          ? new FallbackRetriever(
              new VectorRetriever(embeddings, store),
              keywords,
            )
          : keywords;
      },
    },
    PlaybookDrafter,
    PlaybooksService,
  ],
  exports: [PlaybooksService],
})
export class PlaybooksModule {}
