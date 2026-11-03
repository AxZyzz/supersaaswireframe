import { MockAIProvider } from '../providers/mock.provider';
import {
  classifyReply,
  PROMPT_VERSIONS,
  REPLY_CLASSES,
  sequencePrompt,
} from '../prompts';
import { checkSequence, scoreClassification } from './evaluate';
import { CLASSIFY_CASES, SEQUENCE_CASES } from './fixtures';

/** Guards the eval harness itself (runs in CI with no AI credentials). */
describe('AI eval harness', () => {
  it('fixtures are well-formed and cover every class', () => {
    const ids = CLASSIFY_CASES.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const cls of REPLY_CLASSES) {
      expect(CLASSIFY_CASES.some((c) => c.expected === cls)).toBe(true);
    }
    expect(SEQUENCE_CASES.length).toBeGreaterThanOrEqual(5);
  });

  it('scores classification, honouring acceptable alternatives', () => {
    const cases = CLASSIFY_CASES.filter((c) => ['q-4', 'ni-1'].includes(c.id));
    const s = scoreClassification(cases, {
      'q-4': 'interested',
      'ni-1': 'question',
    });
    expect(s.correct).toBe(1); // q-4 allows interested; ni-1 is a miss
    expect(s.misses.map((m) => m.id)).toEqual(['ni-1']);
    expect(s.byClass.question).toEqual({ total: 1, correct: 1 });
  });

  it('flags structural and deliverability problems in a sequence', () => {
    const issues = checkSequence({ id: 'x', goal: 'g', steps: 2 }, [
      {
        subject: 'Act now — limited time!',
        body: 'Click here.',
        delayHours: 24,
      },
      { subject: '', body: 'Hi {firstname}', delayHours: 0 },
    ]);
    expect(issues).toEqual(
      expect.arrayContaining([
        'first step should send immediately (delayHours 0)',
        'step 2 delay must be later than step 1',
        'step 2 has no subject',
        'step 1 contains spam phrase "act now"',
        'step 2 uses unknown token {firstname}',
        'no personalization tokens used',
      ]),
    );
  });

  it('mock provider output passes the sequence checks (pipeline sanity)', async () => {
    const mock = new MockAIProvider();
    for (const c of SEQUENCE_CASES) {
      const r = await mock.generate(sequencePrompt(c));
      const steps = (JSON.parse(r.text) as { steps: never[] }).steps;
      expect(checkSequence(c, steps)).toEqual([]);
    }
  });

  it('every prompt carries a version tag', () => {
    expect(classifyReply({ replyBody: 'hi' }).promptVersion).toBe(
      PROMPT_VERSIONS.classifyReply,
    );
    expect(sequencePrompt({ goal: 'g' }).promptVersion).toBe(
      PROMPT_VERSIONS.sequence,
    );
  });
});
