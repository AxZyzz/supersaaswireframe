import { readFileSync } from 'fs';
import { join } from 'path';
import { contractError } from './contracts';
import { fixture, SHARED_AGENTS_DIR, sharedSchemaFiles } from './fixtures';

// Same fixtures, same schemas as apps/agents/tests/test_contracts.py.
describe('agent contracts', () => {
  it.each([
    ['review-analyst.input', 'review-analyst-input.valid'],
    ['review-analyst.output', 'review-analyst-output.valid'],
    // schema-valid on purpose: the validator, not the schema, catches these
    ['review-analyst.output', 'review-analyst-output.hallucinated-number'],
    ['review-analyst.output', 'review-analyst-output.premature-winner'],
    ['review-analyst.output', 'review-analyst-output.unknown-finding'],
    ['copywriter.input', 'copywriter-input.valid'],
    ['copywriter.output', 'copywriter-output.valid'],
    ['discover.input', 'discover-input.valid'],
    ['discover.input', 'discover-input.targeted'],
    ['discover.input', 'discover-input.playbooks'],
    ['discover.output', 'discover-output.valid'],
    // schema-valid on purpose: the API re-checks quotes and decides matchedPreference itself
    ['discover.output', 'discover-output.unverified-trigger'],
    ['discover.output', 'discover-output.claims-match'],
  ] as const)('%s accepts %s', (schema, name) => {
    expect(contractError(schema, fixture(name))).toBeNull();
  });

  it('rejects two candidates, a bad finding id, extra fields and lead fields', () => {
    const two = fixture<{ candidates: unknown[] }>('copywriter-output.valid');
    two.candidates = two.candidates.slice(0, 2);
    expect(contractError('copywriter.output', two)).not.toBeNull();

    const badId = fixture<{ points: Array<{ findingIds: string[] }> }>(
      'review-analyst-output.valid',
    );
    badId.points[0].findingIds = ['finding-1'];
    expect(contractError('review-analyst.output', badId)).not.toBeNull();

    const extra = {
      ...fixture<object>('review-analyst-output.valid'),
      confidence: 1,
    };
    expect(contractError('review-analyst.output', extra)).not.toBeNull();

    const lead = {
      ...fixture<object>('review-analyst-input.valid'),
      leadEmail: 'someone@example.com',
    };
    expect(contractError('review-analyst.input', lead)).not.toBeNull();
  });

  it('rejects an oversized or malformed Discover request', () => {
    const big = fixture<{ targetCount: number }>('discover-input.valid');
    big.targetCount = 51;
    expect(contractError('discover.input', big)).not.toBeNull();
    const noRun = { ...fixture<object>('discover-input.valid') } as Record<
      string,
      unknown
    >;
    delete noRun.runId;
    expect(contractError('discover.input', noRun)).not.toBeNull();
    const lead = {
      ...fixture<object>('discover-input.valid'),
      leadEmail: 'someone@example.com',
    };
    expect(contractError('discover.input', lead)).not.toBeNull();
    const badFactor = fixture<{ preference: { filter: { factor: string } } }>(
      'discover-input.targeted',
    );
    badFactor.preference.filter.factor = 'favourite_colour';
    expect(contractError('discover.input', badFactor)).not.toBeNull();
  });

  it('rejects a Discover answer with a bad trigger type or an extra field', () => {
    const bad = fixture<{
      candidates: Array<{ triggers: Array<{ type: string }> }>;
    }>('discover-output.unverified-trigger');
    bad.candidates[0].triggers[0].type = 'vibes';
    expect(contractError('discover.output', bad)).not.toBeNull();
    const extra = {
      ...fixture<object>('discover-output.valid'),
      confidence: 0.9,
    };
    expect(contractError('discover.output', extra)).not.toBeNull();
  });

  it('the schema copies in the API match packages/shared (run `npm run contracts:sync -w apps/api`)', () => {
    const files = sharedSchemaFiles();
    expect(files.length).toBe(6);
    for (const f of files) {
      const shared = readFileSync(join(SHARED_AGENTS_DIR, f), 'utf8').replace(
        /\r\n/g,
        '\n',
      );
      const copy = readFileSync(
        join(__dirname, 'contracts', f),
        'utf8',
      ).replace(/\r\n/g, '\n');
      expect(copy).toBe(shared);
    }
  });
});
