import { readFileSync } from 'fs';
import { join } from 'path';
import { ConfigService } from '@nestjs/config';
import type { AiService } from '../ai/ai.service';
import type { SafetyScreen } from '../ai/safety/safety-screen';
import { decide } from '../review/policy';
import { explain } from '../review/policy/explain-template';
import { simulate } from '../review/simulation';
import { AiChallengerDrafter } from '../review/challenger-drafter';
import { A2aClientService, A2aUnavailableError } from './a2a-client.service';
import { AgentChallengerDrafter, mergeTokensOk } from './copywriter-drafter';
import type { ReviewAnalystOutput } from './contracts';
import { buildEvidencePackage } from './evidence';
import { fixture } from './fixtures';
import { ReviewExplainerService } from './review-explainer.service';
import { REVIEW_ANALYST_INSTRUCTION } from './review-prompt';
import { validateExplanation } from './explanation-validator';

const cfg = (env: Record<string, string> = {}) =>
  ({ get: (k: string) => env[k] }) as unknown as ConfigService;

/** A real ReviewResult from the policy on simulated data (the inconclusive scenario). */
function realResult() {
  const sim = simulate('inconclusive_small');
  // simulation data is flagged simulated; a real review is not (simulated ones skip the AI)
  return { ...decide(sim.input), simulated: false, slices: sim.slices };
}

describe('evidence package', () => {
  it('is built from a real ReviewResult, matches the contract and holds no lead data', () => {
    const result = realResult();
    const pkg = buildEvidencePackage('rev-1', 2, result);
    expect(pkg.decision).toBe(result.decision);
    expect(pkg.findings.map((f) => f.id)).toEqual(
      result.findings.map((f) => f.id),
    );
    // aggregates only: nothing that looks like an email or a person
    expect(JSON.stringify(pkg)).not.toMatch(/@[a-z0-9-]+\./i);
  });

  it("the template's own explanation passes the number checks (so real formats parse)", () => {
    const result = realResult();
    const pkg = buildEvidencePackage('rev-1', 2, result);
    const tpl = explain(result);
    const asAgent: ReviewAnalystOutput = {
      summary: tpl.summary.split(/\s+/).slice(0, 60).join(' '),
      points: tpl.points.slice(0, 5),
      caveats: [],
      suggestedNextStep: 'none',
    };
    const check = validateExplanation(asAgent, pkg);
    // only a wording rule may object (the template says "winner" while explaining), never a number or id
    if (!check.ok)
      expect(check.reason).not.toMatch(/number|unknown finding|schema/);
  });
});

describe('ReviewExplainerService', () => {
  const sharedEvidence = () =>
    fixture<ReturnType<typeof buildEvidencePackage>>(
      'review-analyst-input.valid',
    );

  const make = (
    env: Record<string, string>,
    call: jest.Mock,
    ai: Partial<AiService> = {},
    safety?: SafetyScreen,
  ) => {
    const svc = new ReviewExplainerService(
      cfg(env),
      { call } as unknown as A2aClientService,
      ai as AiService,
      safety,
    );
    // the shared contract fixture stands in for the evidence of a real review
    svc.buildEvidence = () => sharedEvidence();
    return svc;
  };
  const agentReturns = (output: unknown, traceChar = 'a') =>
    jest.fn().mockResolvedValue({
      output,
      traceId: traceChar.repeat(32),
      latencyMs: 3,
    });

  it('defaults to the template and never calls an agent', async () => {
    const call = jest.fn();
    const out = await make({}, call).explain('o', 'r', 1, realResult());
    expect(out.source).toBe('template');
    expect(call).not.toHaveBeenCalled();
  });

  it('agent mode: a valid answer is used, marked source=agent, with its trace id', async () => {
    const call = agentReturns(fixture('review-analyst-output.valid'), 'd');
    const out = await make({ REVIEW_EXPLAINER: 'agent' }, call).explain(
      'o',
      'r',
      1,
      realResult(),
    );
    expect(call).toHaveBeenCalledWith('review-analyst', expect.anything());
    expect(out.source).toBe('agent');
    expect(out.explanation.suggestedNextStep).toBe('keep_testing');
    expect(out.explanation.points).toHaveLength(3);
    expect(out.explanation.traceId).toBe('d'.repeat(32));
  });

  it('agent mode: a hallucinated number is rejected; the template is stored with the reason (acceptance 3)', async () => {
    const result = realResult();
    const call = agentReturns(
      fixture('review-analyst-output.hallucinated-number'),
      'a',
    );
    const out = await make({ REVIEW_EXPLAINER: 'agent' }, call).explain(
      'o',
      'r',
      1,
      result,
    );
    expect(out.source).toBe('template');
    expect(out.explanation.fallbackReason).toMatch(
      /number 9 is not in the cited findings/,
    );
    expect(out.explanation.traceId).toBe('a'.repeat(32));
    // what is stored is the deterministic template text, not the agent's
    expect(out.explanation.summary).toBe(explain(result).summary);
  });

  it('agent mode: a premature "winner" and an unknown finding id also fall back', async () => {
    for (const name of [
      'review-analyst-output.premature-winner',
      'review-analyst-output.unknown-finding',
    ]) {
      const out = await make(
        { REVIEW_EXPLAINER: 'agent' },
        agentReturns(fixture(name)),
      ).explain('o', 'r', 1, realResult());
      expect(out.source).toBe('template');
      expect(out.explanation.fallbackReason).toBeTruthy();
    }
  });

  it('agent mode: unreachable agent -> template with the reason and the trace id', async () => {
    const call = jest
      .fn()
      .mockRejectedValue(
        new A2aUnavailableError(
          'review-analyst did not answer: boom',
          'b'.repeat(32),
        ),
      );
    const out = await make({ REVIEW_EXPLAINER: 'agent' }, call).explain(
      'o',
      'r',
      1,
      realResult(),
    );
    expect(out.source).toBe('template');
    expect(out.explanation.fallbackReason).toMatch(/did not answer/);
    expect(out.explanation.traceId).toBe('b'.repeat(32));
  });

  it('agent mode: output blocked by the safety screen -> template', async () => {
    const safety: SafetyScreen = {
      name: 'fake',
      screenInput: jest.fn(),
      screenOutput: jest.fn().mockResolvedValue({
        verdict: 'blocked',
        findings: [],
        provider: 'fake',
      }),
    };
    const out = await make(
      { REVIEW_EXPLAINER: 'agent' },
      agentReturns(fixture('review-analyst-output.valid')),
      {},
      safety,
    ).explain('o', 'r', 1, realResult());
    expect(out.source).toBe('template');
    expect(out.explanation.fallbackReason).toBe('withheld by safety check');
  });

  it('gemini mode: the same instruction goes through AiService with the review_explain task', async () => {
    const generate = jest.fn().mockResolvedValue({
      text: JSON.stringify(fixture('review-analyst-output.valid')),
    });
    const out = await make({ REVIEW_EXPLAINER: 'gemini' }, jest.fn(), {
      generate,
    }).explain('o', 'r', 1, realResult());
    expect(out.source).toBe('gemini');
    const [, feature, opts] = generate.mock.calls[0] as [
      string,
      string,
      { system: string; task: string; jsonSchema: Record<string, unknown> },
    ];
    expect(feature).toBe('review-explain');
    expect(opts.task).toBe('review_explain');
    expect(opts.system).toBe(REVIEW_ANALYST_INSTRUCTION);
    expect(opts.jsonSchema.$schema).toBeUndefined();
  });

  it('simulated reviews always use the template (practice data is never sent to an AI)', async () => {
    const call = jest.fn();
    const result = { ...realResult(), simulated: true };
    const out = await make({ REVIEW_EXPLAINER: 'agent' }, call).explain(
      'o',
      'r',
      1,
      result,
    );
    expect(out.source).toBe('template');
    expect(call).not.toHaveBeenCalled();
  });
});

describe('the TypeScript instruction matches the Python agent', () => {
  it('REVIEW_ANALYST_INSTRUCTION is the Python INSTRUCTION, word for word', () => {
    const py = readFileSync(
      join(
        __dirname,
        '..',
        '..',
        '..',
        'agents',
        'expelly_agents',
        'review_analyst',
        'agent.py',
      ),
      'utf8',
    ).replace(/\r\n/g, '\n');
    const m = /INSTRUCTION = """\\\n([\s\S]*?)"""/.exec(py);
    expect(m).not.toBeNull();
    expect(REVIEW_ANALYST_INSTRUCTION).toBe((m as RegExpExecArray)[1]);
  });
});

describe('AgentChallengerDrafter (Copywriter)', () => {
  const input = {
    orgId: 'o',
    baseSubject: 'Quick idea for {company|your team}',
    avoid: ['Quick idea for {company|your team}', 'Checking in about outreach'],
    offerName: 'Cold-email platform',
    offerDescription: 'AI outreach that learns what works.',
    kb: 'Audience: agency founders.',
  };
  const agentOut = (subjects: string[]) => ({
    candidates: subjects.map((subject) => ({ subject, rationale: 'angle' })),
  });
  const make = (
    env: Record<string, string>,
    call: jest.Mock,
    gemini?: Partial<AiChallengerDrafter>,
    safety?: SafetyScreen,
  ) =>
    new AgentChallengerDrafter(
      cfg(env),
      { call } as unknown as A2aClientService,
      (gemini ?? {
        draft: jest
          .fn()
          .mockResolvedValue([{ subject: 'from gemini', source: 'gemini' }]),
      }) as AiChallengerDrafter,
      safety,
    );

  it("default driver is the Gemini drafter (today's behaviour), no agent call", async () => {
    const call = jest.fn();
    const out = await make({}, call).draft(input);
    expect(out[0].source).toBe('gemini');
    expect(call).not.toHaveBeenCalled();
  });

  it('mock driver: deterministic template subjects, no AI at all', async () => {
    const call = jest.fn();
    const out = await make({ COPYWRITER_DRIVER: 'mock' }, call).draft(input);
    expect(out).toHaveLength(3);
    expect(out.every((c) => c.source === 'mock')).toBe(true);
    expect(call).not.toHaveBeenCalled();
  });

  it('agent driver: three valid candidates come back marked source=agent; the request holds no lead data', async () => {
    const call = jest.fn().mockResolvedValue({
      output: agentOut([
        '{first_name|there}, a faster way to book demos',
        'What {company|your team} could test this week',
        'Which subject line wins for {company|your team}?',
      ]),
      traceId: 'e'.repeat(32),
      latencyMs: 4,
    });
    const out = await make({ COPYWRITER_DRIVER: 'agent' }, call).draft(input);
    expect(out.map((c) => c.source)).toEqual(['agent', 'agent', 'agent']);
    const [name, req] = call.mock.calls[0] as [string, Record<string, unknown>];
    expect(name).toBe('copywriter');
    expect(req.constraints).toEqual({
      maxChars: 60,
      keepMergeTokens: true,
      language: 'en',
    });
    expect(JSON.stringify(req)).not.toMatch(/@/);
  });

  it('agent driver: duplicates, over-long subjects and broken merge tokens are dropped, templates top up to 3', async () => {
    const call = jest.fn().mockResolvedValue({
      output: agentOut([
        'Quick idea for {company|your team}', // duplicate of the control
        'x'.repeat(70), // too long
        'Hello {firstname|there}', // unknown merge variable
      ]),
      traceId: 'f'.repeat(32),
      latencyMs: 4,
    });
    const out = await make({ COPYWRITER_DRIVER: 'agent' }, call).draft(input);
    expect(out).toHaveLength(3);
    expect(out.every((c) => c.source === 'template')).toBe(true);
  });

  it('agent driver: blocked by the safety screen -> Gemini drafter', async () => {
    const call = jest.fn().mockResolvedValue({
      output: agentOut([
        'One angle for {company|your team}',
        'Two angles',
        'Three angles',
      ]),
      traceId: 'g'.repeat(32),
      latencyMs: 1,
    });
    const safety: SafetyScreen = {
      name: 'fake',
      screenInput: jest.fn(),
      screenOutput: jest.fn().mockResolvedValue({
        verdict: 'blocked',
        findings: [],
        provider: 'fake',
      }),
    };
    const out = await make(
      { COPYWRITER_DRIVER: 'agent' },
      call,
      undefined,
      safety,
    ).draft(input);
    expect(out[0].source).toBe('gemini');
  });

  it('agent driver: schema-invalid output (2 candidates) or an unreachable agent -> Gemini drafter', async () => {
    const two = jest.fn().mockResolvedValue({
      output: agentOut(['a', 'b']),
      traceId: 'h'.repeat(32),
      latencyMs: 1,
    });
    expect(
      (await make({ COPYWRITER_DRIVER: 'agent' }, two).draft(input))[0].source,
    ).toBe('gemini');
    const down = jest.fn().mockRejectedValue(new A2aUnavailableError('down'));
    expect(
      (await make({ COPYWRITER_DRIVER: 'agent' }, down).draft(input))[0].source,
    ).toBe('gemini');
  });
});

describe('merge tokens', () => {
  it('accepts known variables with or without a fallback and rejects the rest', () => {
    expect(mergeTokensOk('Hi {first_name|there}')).toBe(true);
    expect(mergeTokensOk('For {company}')).toBe(true);
    expect(mergeTokensOk('No tokens at all')).toBe(true);
    expect(mergeTokensOk('Hi {firstname|there}')).toBe(false);
    expect(mergeTokensOk('Hi {first_name')).toBe(false);
    expect(mergeTokensOk('Hi first_name}')).toBe(false);
    expect(mergeTokensOk('Hi {{first_name}}')).toBe(false);
  });
});
