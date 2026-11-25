/**
 * Runs before every Jest suite. Tests must never depend on — or act on — a
 * developer's local .env: someone testing real Gmail/SMTP or Bedrock locally
 * would otherwise see sends fail (or, worse, go out for real). process.env
 * wins over the .env files ConfigModule loads, so these always apply.
 */
process.env.EMAIL_DRIVER = 'mock';
process.env.AI_DRIVER = 'mock';
// Private BullMQ namespace per test process (see queue.module.ts).
process.env.QUEUE_PREFIX = `test-${process.pid}`;
// Tests never read BigQuery: Insights come from Postgres (T07).
process.env.INSIGHTS_SOURCE = 'postgres';
// Playbook memory (T14): no embeddings API and no BigQuery in tests.
process.env.EMBEDDING_DRIVER = 'mock';
process.env.PLAYBOOK_SEARCH = 'postgres';
