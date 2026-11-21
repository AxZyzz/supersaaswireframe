/**
 * Local check of the two agents over A2A, through the same client the API uses, with the same
 * validation the API applies. Start them first (apps/agents/README.md), then:
 *
 *   npm run try:agents -w apps/api
 *
 * REVIEW_ANALYST_URL / COPYWRITER_URL default to http://localhost:8101 / :8102.
 */
import { ConfigService } from '@nestjs/config';
import { A2aClientService } from '../src/agents/a2a-client.service';
import { contractError } from '../src/agents/contracts';
import type { ReviewAnalystInput } from '../src/agents/contracts';
import { validateExplanation } from '../src/agents/explanation-validator';
import { fixture } from '../src/agents/fixtures';

async function main() {
  const env: Record<string, string | undefined> = {
    REVIEW_ANALYST_URL:
      process.env.REVIEW_ANALYST_URL ?? 'http://localhost:8101',
    COPYWRITER_URL: process.env.COPYWRITER_URL ?? 'http://localhost:8102',
  };
  const a2a = new A2aClientService({
    get: (k: string) => env[k],
  } as unknown as ConfigService);
  a2a.timeoutMs = 60_000;

  const evidence = fixture<ReviewAnalystInput>('review-analyst-input.valid');
  const review = await a2a.call('review-analyst', evidence);
  const check = validateExplanation(review.output, evidence);
  console.log(
    '--- Review analyst (trace',
    review.traceId,
    `${review.latencyMs} ms)`,
  );
  console.log(JSON.stringify(review.output, null, 2));
  console.log(
    check.ok
      ? 'API validator: OK (ids, numbers, wording and next step all check out)'
      : `API validator: REJECTED -> the template would be used. Reason: ${check.reason}`,
  );

  const copy = await a2a.call('copywriter', fixture('copywriter-input.valid'));
  console.log('--- Copywriter (trace', copy.traceId, `${copy.latencyMs} ms)`);
  console.log(JSON.stringify(copy.output, null, 2));
  console.log(
    contractError('copywriter.output', copy.output) ??
      'Contract: OK (exactly 3 candidates)',
  );
}

main()
  .then(() => process.exit(0)) // the circuit-breaker Redis connection would keep the script alive
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
