import type { AiService } from '../ai/ai.service';
import type { ArmReport } from '../review/policy/types';
import {
  buildPreferenceDraft,
  buildReviewDraft,
  checkDraftText,
  PlaybookDrafter,
  type PreferenceDraftInput,
  type ReviewDraftInput,
} from './playbook-drafter';
import { MAX_BODY, MAX_TITLE } from './playbook.types';

const arm = (o: Partial<ArmReport>): ArmReport => ({
  variantId: 'v',
  label: 'A',
  isControl: false,
  assigned: 100,
  qualifiedRate: 0.05,
  qualifiedLo: 0.01,
  qualifiedHi: 0.1,
  qualifiedVerified: 5,
  qualifiedProvisional: 0,
  bookedRate: null,
  qualifiedRateOfDelivered: null,
  sent: 100,
  delivered: 98,
  bounceRate: 0.02,
  unsubscribeRate: 0,
  complaintRate: 0,
  openRate: null,
  replyRate: null,
  ...o,
});

const REVIEW: ReviewDraftInput = {
  offerId: 'offer-1',
  offerName: 'Website redesign for 2 dentists',
  reviewId: 'rev-1',
  revision: 3,
  experimentId: 'exp-1',
  campaignId: 'camp-1',
  decision: 'promote',
  winner: arm({
    variantId: 'w',
    label: 'B',
    assigned: 240,
    qualifiedRate: 0.225,
    qualifiedVerified: 54,
  }),
  control: arm({
    variantId: 'c',
    label: 'A',
    isControl: true,
    assigned: 238,
    qualifiedRate: 0.05,
    qualifiedVerified: 12,
  }),
  lift: { d: 0.175, lo: 0.0214, hi: 0.3293, controlId: 'c', challengerId: 'w' },
  winnerSubject: '5 minutes on {company}?',
  findings: [
    { id: 'F1', kind: 'rate' },
    { id: 'F2', kind: 'lift' },
    { id: 'F3', kind: 'gate' },
  ],
  computedAt: '2026-11-22T10:00:00.000Z',
};

const PREF: PreferenceDraftInput = {
  offerId: 'offer-1',
  preferenceId: 'pref-1',
  segment: { factor: 'city', value: 'Pune' },
  label: 'City: Pune',
  metric: 'qualified',
  x: 8,
  n: 60,
  p: 0.1333,
  lo: 0.0693,
  hi: 0.2424,
  overallP: 0.0444,
  confounding: 'Most of these were also hiring (100% vs 33% overall).',
  computedAt: '2026-11-22T10:00:00.000Z',
};

describe('playbook text built by code (T14)', () => {
  it('a message playbook quotes only numbers the evidence holds, and fits the limits', () => {
    const d = buildReviewDraft(REVIEW);
    expect(d.kind).toBe('message');
    expect(d.segment).toBeNull();
    expect(d.title.length).toBeLessThanOrEqual(MAX_TITLE);
    expect(d.body.length).toBeLessThanOrEqual(MAX_BODY);
    expect(d.body).toContain('22.5% vs 5%');
    expect(d.body).toContain('54 of 240');
    expect(d.body).toContain('17.5 points');
    expect(d.body).toContain('5 minutes on {company}?'); // the winning subject, digits and all
    expect(d.validDays).toBe(90);
    expect(d.evidence).toMatchObject({
      source: 'review',
      reviewId: 'rev-1',
      revision: 3,
      experimentId: 'exp-1',
      campaignId: 'camp-1',
      decision: 'promote',
      findingIds: ['F1', 'F2'], // only rate and lift findings
    });
    // the same gate the AI wording has to pass: the template can never drift from the evidence
    expect(checkDraftText({ ...d })).toEqual({ ok: true });
  });

  it('an offer name with digits in the title is allowed (it is code-supplied context)', () => {
    const d = buildReviewDraft(REVIEW);
    expect(d.title).toContain('2 dentists');
    expect(checkDraftText({ ...d })).toEqual({ ok: true });
  });

  it('an audience playbook says "observation, not proof" and carries its segment', () => {
    const d = buildPreferenceDraft(PREF);
    expect(d.kind).toBe('audience');
    expect(d.segment).toEqual({ factor: 'city', value: 'Pune' });
    expect(d.title).toBe('Find more: City: Pune');
    expect(d.body).toContain('13.3%');
    expect(d.body).toContain('8 of 60');
    expect(d.body).toContain('not proof');
    expect(d.body).toContain('also hiring'); // the confounding hint travels with it
    expect(checkDraftText({ ...d })).toEqual({ ok: true });
  });

  it('long names are cut to the limits instead of failing', () => {
    const d = buildReviewDraft({ ...REVIEW, offerName: 'x'.repeat(300) });
    expect(d.title.length).toBeLessThanOrEqual(MAX_TITLE);
  });
});

describe('the gate every wording must pass (T14)', () => {
  const base = buildReviewDraft(REVIEW);

  it('rejects a number the evidence does not support', () => {
    const r = checkDraftText({
      ...base,
      body: base.body.replace('22.5%', '31.0%'),
    });
    expect(r).toEqual({
      ok: false,
      reason: expect.stringContaining('unsupported number 31'),
    });
  });

  it('accepts a rounded form of a supported number (a percentage written as points)', () => {
    expect(
      checkDraftText({
        ...base,
        title: 'Short question subject',
        body: 'Version B won: 22.5% against 5% with a 17.5 point lift.',
      }),
    ).toEqual({ ok: true });
  });

  it('rejects text outside the length limits', () => {
    expect(checkDraftText({ ...base, title: 'ab' })).toEqual({
      ok: false,
      reason: 'title length',
    });
    expect(checkDraftText({ ...base, body: 'short' })).toEqual({
      ok: false,
      reason: 'body length',
    });
    expect(checkDraftText({ ...base, body: 'x'.repeat(MAX_BODY + 1) })).toEqual(
      {
        ok: false,
        reason: 'body length',
      },
    );
  });

  it('an audience playbook may not claim proof or cause', () => {
    const a = buildPreferenceDraft(PREF);
    for (const bad of [
      'Pune hiring companies proved they reply more (8 of 60).',
      'This was significantly better: 13.3% against 4.4%.',
      'Being in Pune caused the higher rate of 13.3%.',
    ]) {
      expect(checkDraftText({ ...a, body: bad })).toEqual({
        ok: false,
        reason: 'claims proof or cause',
      });
    }
  });
});

describe('PlaybookDrafter.polish (T14)', () => {
  const ai = (text: string | Error, provider = 'gemini') =>
    ({
      providerName: () => provider,
      generate: () =>
        text instanceof Error
          ? Promise.reject(text)
          : Promise.resolve({ text }),
    }) as unknown as AiService;
  const message = buildReviewDraft(REVIEW);
  const audience = buildPreferenceDraft(PREF);

  it('keeps a wording whose numbers are all in the evidence, and says it came from the AI', async () => {
    const d = await new PlaybookDrafter(
      ai(
        JSON.stringify({
          title: 'A short question won the subject test',
          body: 'Version B got 22.5% qualified replies against 5.0% for the control, a lift of 17.5 points.',
        }),
      ),
    ).polish('org', message);
    expect(d.source).toBe('gemini');
    expect(d.title).toBe('A short question won the subject test');
    expect(d.evidence).toEqual(message.evidence); // the evidence is always the code-built one
  });

  it('labels the source mock under AI_DRIVER=mock', async () => {
    const d = await new PlaybookDrafter(
      ai(
        JSON.stringify({
          title: 'Short question wins',
          body: 'Version B won with 22.5% against 5.0%.',
        }),
        'mock',
      ),
    ).polish('org', message);
    expect(d.source).toBe('mock');
  });

  it('an unchanged wording is labelled as the template, not as an AI rewording', async () => {
    const d = await new PlaybookDrafter(
      ai(JSON.stringify({ title: message.title, body: message.body })),
    ).polish('org', message);
    expect(d.source).toBe('template');
  });

  it('falls back to the template when the AI invents a number', async () => {
    const d = await new PlaybookDrafter(
      ai(
        JSON.stringify({
          title: 'Short question wins',
          body: 'Version B won with 40% against 5.0%.',
        }),
      ),
    ).polish('org', message);
    expect(d.source).toBe('template');
    expect(d.body).toBe(message.body);
  });

  it('falls back when the answer is not JSON, is missing a field, or the AI fails', async () => {
    for (const a of [
      ai('not json'),
      ai(JSON.stringify({ title: 'only a title' })),
      ai(new Error('quota')),
    ]) {
      const d = await new PlaybookDrafter(a).polish('org', message);
      expect(d.source).toBe('template');
      expect(d.title).toBe(message.title);
    }
  });

  it('an audience wording that claims proof is dropped', async () => {
    const d = await new PlaybookDrafter(
      ai(
        JSON.stringify({
          title: 'Pune proved itself',
          body: 'Pune proved it replies more: 13.3% (8 of 60).',
        }),
      ),
    ).polish('org', audience);
    expect(d.source).toBe('template');
    expect(d.title).toBe(audience.title);
  });
});
