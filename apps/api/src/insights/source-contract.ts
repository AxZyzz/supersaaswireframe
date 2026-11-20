import { FACTOR_IDS, type InsightsQuery, type InsightsSource } from './types';

/**
 * The contract every InsightsSource must keep (Learning Loop T06). Postgres
 * passes it today; T07's BigQuery source must pass the same checks against the
 * same data. Throws (so it works inside any test runner) when broken.
 */
export async function assertInsightsSourceContract(
  source: InsightsSource,
  q: InsightsQuery,
): Promise<void> {
  const fail = (m: string): never => {
    throw new Error(`InsightsSource contract (${source.name}): ${m}`);
  };
  const data = await source.all(q);

  for (const f of FACTOR_IDS) {
    if (!Array.isArray(data.buckets[f])) fail(`missing factor ${f}`);
    for (const b of data.buckets[f]) {
      if (b.factor !== f)
        fail(`${f}: bucket ${b.bucket} has factor ${b.factor}`);
      if (!b.bucket) fail(`${f}: empty bucket name (use "unknown")`);
      for (const k of [
        'sent',
        'reached',
        'bounced',
        'opened',
        'replied',
        'positive',
        'qualified',
        'booked',
        'unsubscribed',
        'discovered',
        'eligible',
      ] as const) {
        if (!Number.isInteger(b[k]) || b[k] < 0)
          fail(`${f}/${b.bucket}: ${k} must be a count`);
      }
      if (b.reached > b.sent) fail(`${f}/${b.bucket}: reached > sent`);
      if (b.sent - b.reached !== b.bounced && f !== 'sequence_step') {
        fail(`${f}/${b.bucket}: sent - reached must equal bounced`);
      }
      for (const k of [
        'replied',
        'positive',
        'qualified',
        'booked',
        'opened',
        'unsubscribed',
      ] as const) {
        if (b[k] > b.reached) fail(`${f}/${b.bucket}: ${k} > reached`);
      }
      if (b.eligible > b.discovered)
        fail(`${f}/${b.bucket}: eligible > discovered`);
      if (
        b.medianHoursToReply !== null &&
        !(typeof b.medianHoursToReply === 'number' && b.medianHoursToReply >= 0)
      ) {
        fail(`${f}/${b.bucket}: medianHoursToReply`);
      }
    }
  }

  // each company is in exactly one bucket of a per-company factor
  for (const f of FACTOR_IDS) {
    if (f === 'sequence_step') continue;
    const reached = data.buckets[f].reduce((n, b) => n + b.reached, 0);
    if (reached !== data.totals.reached) {
      fail(
        `${f}: buckets add up to ${reached}, totals say ${data.totals.reached}`,
      );
    }
  }

  for (const g of data.grid) {
    if (g.day < 0 || g.day > 6 || g.block < 0 || g.block > 7)
      fail('grid cell out of range');
    if (g.replied > g.reached || g.qualified > g.reached)
      fail('grid cell counts');
  }
  if (
    !Number.isInteger(data.timezone.recipient) ||
    !Number.isInteger(data.timezone.workspace)
  ) {
    fail('timezone counts');
  }

  // the two narrow methods agree with the one-pass method
  const city = await source.factorFunnel(q, 'city');
  if (JSON.stringify(city) !== JSON.stringify(data.buckets.city)) {
    fail('factorFunnel(city) differs from all().buckets.city');
  }
  const grid = await source.sendTimeGrid(q);
  if (JSON.stringify(grid) !== JSON.stringify(data.grid)) {
    fail('sendTimeGrid differs from all().grid');
  }
}
