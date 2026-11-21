import {
  AiChallengerDrafter,
  CANDIDATE_COUNT,
  cleanSubject,
  completeCandidates,
  templateSubjects,
  validateSubjects,
} from './challenger-drafter';
import type { AiService } from '../ai/ai.service';

describe('challenger drafter (T11)', () => {
  it('cleans a subject to one short line and refuses junk', () => {
    expect(cleanSubject('  Hello\n\tthere  ')).toBe('Hello there');
    expect(cleanSubject('')).toBeNull();
    expect(cleanSubject('x'.repeat(200))).toBeNull();
    expect(cleanSubject(42)).toBeNull();
  });

  it('keeps distinct valid subjects that are not already in use', () => {
    const out = validateSubjects(
      ['New idea', 'new  idea', 'Subject A', '', 7, 'Another one'],
      ['Subject A'],
    );
    expect(out).toEqual(['New idea', 'Another one']);
    expect(validateSubjects('nope', [])).toEqual([]);
  });

  it('tops up with deterministic templates to exactly three', () => {
    const input = {
      baseSubject: 'Quick idea',
      avoid: ['Quick idea'],
      offerName: 'Audit',
    };
    const out = completeCandidates(['Only one'], input, 'gemini');
    expect(out).toHaveLength(CANDIDATE_COUNT);
    expect(out[0]).toEqual({ subject: 'Only one', source: 'gemini' });
    expect(out.slice(1).every((c) => c.source === 'template')).toBe(true);
    expect(new Set(out.map((c) => c.subject.toLowerCase())).size).toBe(3);
    expect(templateSubjects('Quick idea', null).length).toBeGreaterThanOrEqual(
      3,
    );
  });

  const ai = (impl: () => Promise<{ text: string }>, name = 'gemini') =>
    ({ providerName: () => name, generate: impl }) as unknown as AiService;

  it('uses valid AI output and never sends lead data (subject + offer only)', async () => {
    const generate = jest.fn(() =>
      Promise.resolve({
        text: JSON.stringify({ subjects: ['One', 'Two', 'Three', 'Four'] }),
      }),
    );
    const d = new AiChallengerDrafter(ai(generate));
    const out = await d.draft({
      orgId: 'o',
      baseSubject: 'Base',
      avoid: ['Base'],
      offerName: 'Offer',
      offerDescription: null,
    });
    expect(out.map((c) => c.subject)).toEqual(['One', 'Two', 'Three']);
    const opts = (generate.mock.calls[0] as unknown[])[2] as {
      messages: unknown;
    };
    const sent = JSON.stringify(opts.messages);
    expect(sent).toContain('Base');
    expect(sent).not.toMatch(/@/);
  });

  it('falls back to templates when the AI returns junk or fails', async () => {
    for (const impl of [
      () => Promise.resolve({ text: 'not json' }),
      () => Promise.resolve({ text: JSON.stringify({ subjects: [1, 2] }) }),
      () => Promise.reject(new Error('quota')),
    ]) {
      const d = new AiChallengerDrafter(ai(impl));
      const out = await d.draft({
        orgId: 'o',
        baseSubject: 'Base',
        avoid: ['Base'],
        offerName: null,
        offerDescription: null,
      });
      expect(out).toHaveLength(3);
      expect(out.every((c) => c.source === 'template')).toBe(true);
    }
  });
});
