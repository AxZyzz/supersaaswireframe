import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { A2aClientService } from '../agents/a2a-client.service';
import {
  contractError,
  type DiscoverCandidate,
  type DiscoverFactor,
  type DiscoverInput,
  type DiscoverOutput,
} from '../agents/contracts';
import { AiService } from '../ai/ai.service';
import { hintLine, type PlaybookHint } from '../playbooks/playbook.types';
import { DiscoverRunCache } from './discover-run-cache';
import {
  icpAndCandidatesPrompt,
  type Offer,
  targetedCandidatesPrompt,
} from './prompts';
import { normalizeDomain } from './web-reader';

/**
 * Who plans a Discover search (Learning Loop T10): `native` (the API's own two AI calls, the default
 * and unchanged) or `agent` (the ADK multi-agent over A2A). Either way the API then does the same
 * checks on every company: quotes on the fetched pages, emails literally on the page, MX, scoring,
 * dedupe, caps and storage.
 */
export type DiscoverDriverName = 'native' | 'agent';

export interface Candidate {
  name: string;
  domain: string;
  reason: string;
}

export interface PlanInput {
  orgId: string;
  runId: string;
  goal: string;
  offer: Offer;
  /** The offers-table row of the run (agent mode names it in the request). */
  offerRef: { id: string; name: string; description?: string };
  mode: 'baseline' | 'targeted';
  /** Companies wanted back from an agent (<= 50). */
  count: number;
  /** Native: how many candidates to ask the model for, and keep. */
  askFor: number;
  limit: number;
  preference?: {
    id: string;
    revision: number;
    factor: DiscoverFactor;
    value: string;
    /** native: the plain-words condition for the constrained prompt */
    condition: string;
  };
  excludeCompanyKeys: string[];
  /** Approved learnings (T14) for this offer: hints, not facts. */
  playbooks?: PlaybookHint[];
}

export interface PlanResult {
  icp: Record<string, unknown> | null;
  candidates: Candidate[];
}

/** JSON of a candidate list: tolerant of a bad row, strict about the domain. */
export function parseCandidates(text: string, limit: number): Candidate[] {
  const parsed = JSON.parse(text) as {
    candidates?: { name?: unknown; domain?: unknown; reason?: unknown }[];
  };
  const seen = new Set<string>();
  const out: Candidate[] = [];
  for (const c of parsed.candidates ?? []) {
    const domain =
      typeof c.domain === 'string' ? normalizeDomain(c.domain) : null;
    if (!domain || seen.has(domain) || typeof c.name !== 'string') continue;
    seen.add(domain);
    out.push({
      name: c.name.trim().slice(0, 200),
      domain,
      reason: typeof c.reason === 'string' ? c.reason.slice(0, 400) : '',
    });
    if (out.length >= limit) break;
  }
  return out;
}

/** Today's pipeline, behind the interface with no behaviour change. */
@Injectable()
export class NativeDiscoverDriver {
  readonly name: DiscoverDriverName = 'native';

  constructor(private readonly ai: AiService) {}

  async plan(input: PlanInput): Promise<PlanResult> {
    if (input.mode === 'targeted') {
      const t = await this.ai.generate(input.orgId, 'prospect-targeted', {
        ...targetedCandidatesPrompt(
          input.goal,
          input.offer,
          input.preference?.condition ?? '',
          input.askFor,
          input.playbooks?.map(hintLine),
        ),
        task: 'discover_plan',
      });
      return {
        icp: null,
        candidates: parseCandidates(t.text, input.limit),
      };
    }
    const res = await this.ai.generate(input.orgId, 'prospect-icp', {
      ...icpAndCandidatesPrompt(
        input.goal,
        input.offer,
        input.askFor,
        input.playbooks?.map(hintLine),
      ),
      task: 'discover_plan',
    });
    const parsed = JSON.parse(res.text) as { icp?: Record<string, unknown> };
    return {
      icp: parsed.icp ?? null,
      candidates: parseCandidates(res.text, input.limit),
    };
  }
}

/** How the agent's claim looks to the API's own verification (the same shape the AI analysis has). */
export function claimToAnalysis(c: DiscoverCandidate): Record<string, unknown> {
  return {
    isRealBusinessSite: c.isRealBusinessSite !== false,
    companyName: c.name,
    summary: c.summary,
    industry: c.attributes.industry,
    location: c.attributes.location,
    city: c.attributes.city,
    region: c.attributes.region,
    country: c.attributes.country,
    sizeBand: c.attributes.size_band,
    triggers: c.triggers,
    facts: c.evidence.map((e) => ({
      fact: e.fact ?? '',
      quote: e.quote,
      url: e.url,
    })),
    opportunity: c.opportunity,
    unknowns: c.unknowns,
    scores: c.scores ?? {},
  };
}

export const AGENT_ATTR_VERSION = 'agent-discover@1';
export const DEFAULT_AGENT_TIMEOUT_MS = 5 * 60_000;

/** The ADK Discover agent over A2A. Throws when it cannot answer: the caller falls back to native. */
@Injectable()
export class AgentDiscoverDriver {
  readonly name: DiscoverDriverName = 'agent';
  private readonly logger = new Logger(AgentDiscoverDriver.name);

  constructor(
    private readonly a2a: A2aClientService,
    private readonly cache: DiscoverRunCache,
    private readonly config: ConfigService,
  ) {}

  timeoutMs(): number {
    const n = Number(this.config.get<string>('DISCOVER_AGENT_TIMEOUT_MS'));
    return Number.isFinite(n) && n >= 1000 ? n : DEFAULT_AGENT_TIMEOUT_MS;
  }

  buildRequest(input: PlanInput): DiscoverInput {
    const req: DiscoverInput = {
      runId: input.runId,
      orgId: input.orgId,
      offer: {
        id: input.offerRef.id,
        name: input.offerRef.name,
        ...(input.offerRef.description
          ? { description: input.offerRef.description }
          : {}),
      },
      seller: {
        description: input.offer.description ?? null,
        offer: input.offer.offer ?? null,
        audience: input.offer.audience ?? null,
        painPoints: input.offer.painPoints ?? null,
      },
      goal: input.goal,
      targetCount: Math.max(1, Math.min(50, input.count)),
      mode: input.mode,
      excludeCompanyKeys: input.excludeCompanyKeys.slice(0, 2000),
    };
    if (input.playbooks?.length) {
      req.playbooks = input.playbooks.slice(0, 5).map((p) => ({
        title: p.title,
        body: p.body,
        validTo: p.validTo,
      }));
    }
    if (input.mode === 'targeted' && input.preference) {
      req.preference = {
        id: input.preference.id,
        revision: input.preference.revision,
        filter: {
          factor: input.preference.factor,
          value: input.preference.value,
        },
      };
    }
    return req;
  }

  async plan(
    input: PlanInput,
  ): Promise<PlanResult & { stats: DiscoverOutput['stats'] }> {
    const req = this.buildRequest(input);
    const bad = contractError('discover.input', req);
    if (bad) throw new Error(`Discover request is not valid: ${bad}`);

    await this.cache.pushStep(
      input.runId,
      input.mode === 'targeted'
        ? `Agent: planning the targeted search (${req.preference?.filter.factor}: ${req.preference?.filter.value})`
        : 'Agent: planning the search and finding companies',
    );
    const res = await this.a2a.call('discover', req);
    const output = res.output as DiscoverOutput;
    const err = contractError('discover.output', output);
    if (err) throw new Error(`Discover answer is not valid: ${err}`);
    if (output.runId !== req.runId || output.mode !== req.mode) {
      throw new Error('Discover answered for a different run or mode');
    }

    // normalise, de-duplicate, drop what we already know, cap: the agent's list is a claim
    const exclude = new Set(
      input.excludeCompanyKeys.map((k) => k.toLowerCase()),
    );
    const seen = new Set<string>();
    const claims: DiscoverCandidate[] = [];
    for (const c of output.candidates) {
      const domain = normalizeDomain(c.domain);
      if (!domain || seen.has(domain) || exclude.has(domain)) continue;
      seen.add(domain);
      claims.push({ ...c, domain });
      if (claims.length >= req.targetCount) break;
    }
    await this.cache.setClaims(input.runId, claims);
    await this.cache.pushStep(
      input.runId,
      `Agent returned ${claims.length} companies (proposed ${output.stats.proposed}, ${output.stats.droppedUnverified} not backed up by their pages, ${output.stats.droppedSafety} blocked by the safety check). Now checking them.`,
    );
    this.logger.log(
      JSON.stringify({
        event: 'discover_agent',
        run_id: input.runId,
        mode: input.mode,
        trace_id: res.traceId,
        latency_ms: res.latencyMs,
        returned: claims.length,
        ...output.stats,
      }),
    );
    return {
      icp: { summary: input.goal, industries: [], regions: [], buyerRoles: [] },
      candidates: claims.map((c) => ({
        name: c.name.slice(0, 200),
        domain: c.domain,
        reason: (c.summary ?? '').slice(0, 400),
      })),
      stats: output.stats,
    };
  }
}
