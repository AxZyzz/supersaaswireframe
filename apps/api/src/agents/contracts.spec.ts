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

  it('the schema copies in the API match packages/shared (run `npm run contracts:sync -w apps/api`)', () => {
    const files = sharedSchemaFiles();
    expect(files.length).toBe(4);
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
