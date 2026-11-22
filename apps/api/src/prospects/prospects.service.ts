import { InjectQueue } from '@nestjs/bullmq';
import {
  BadRequestException,
  ConflictException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue } from 'bullmq';
import type { DiscoverCandidate } from '../agents/contracts';
import { Pool, PoolClient } from 'pg';
import { AiService } from '../ai/ai.service';
import {
  SAFETY_SCREEN,
  screenInputChunked,
  type SafetyScreen,
} from '../ai/safety/safety-screen';
import { PG_POOL } from '../db/db.module';
import { PlaybooksService } from '../playbooks/playbooks.service';
import { withOrgContext } from '../db/tenant-context';
import { companyKey, FREE_MAIL } from '../leads/company-key';
import type { MailProvider } from '../leads/attributes';
import { MailProviderService } from '../leads/mail-provider.service';
import { LeadsService } from '../leads/leads.service';
import { OffersService } from '../campaigns/offers.service';
import { UsageService } from '../usage/usage.service';
import { SegmentsService } from '../leads/segments/segments.service';
import { PROSPECT_QUEUE } from '../queue/queue.module';
import {
  type Allocation,
  allocationLine,
  describeFilter,
  isSearchFactor,
  matchesFactor,
  reservedSlots,
} from '../search-preferences/preference-logic';
import {
  AGENT_ATTR_VERSION,
  AgentDiscoverDriver,
  claimToAnalysis,
  type DiscoverDriverName,
  NativeDiscoverDriver,
  type PlanInput,
  type PlanResult,
} from './discover-driver';
import {
  DiscoverRunCache,
  MAX_AGENT_FETCHES_PER_RUN,
} from './discover-run-cache';
import { ATTR_PROMPT_VERSION, type Offer, researchPrompt } from './prompts';
import {
  cleanIndustry,
  cleanSizeBand,
  verifyLocation,
  verifyTriggers,
} from './attributes';
import {
  cleanOpportunity,
  cleanUnknowns,
  type ProspectEmail,
  scoreProspect,
  verifyEvidence,
} from './scoring';
import {
  extractEmails,
  fetchPage,
  type FetchedPage,
  hasMx,
  htmlToText,
  metaDescription,
  normalizeDomain,
  pageTitle,
  parseRobots,
  robotsAllows,
  subpageLinks,
} from './web-reader';

export const MAX_PROSPECTS_PER_RUN = 20;
const PAGE_TEXT_LIMIT = 6_000;
const TOTAL_TEXT_LIMIT = 16_000;
const RESEARCH_CONCURRENCY = 3;
/** One company check may not hold a worker longer than this. */
const PROSPECT_DEADLINE_MS = 120_000;
/** A search still queued/running after this was interrupted (restart, crash). */
const STALE_RUN_MINUTES = 45;

/** Test seam: swap the network for fixtures. */
export interface ProspectIO {
  fetchPage: (url: string) => Promise<FetchedPage>;
  hasMx: (domain: string) => Promise<boolean>;
  /** MX-based mailbox provider of a domain (cached). */
  mailProvider?: (domain: string) => Promise<MailProvider>;
}

export interface RunRow {
  id: string;
  goal: string;
  offer_id: string | null;
  icp: unknown;
  status: string;
  requested: number;
  total: number;
  done: number;
  verified: number;
  error: string | null;
  created_at: Date;
  finished_at: Date | null;
  /** T12: the search preference pinned when the run started, and how it was used. */
  preference_id: string | null;
  preference_revision: number | null;
  allocation: (Allocation & StoredAllocation) | null;
  /** T14: the playbooks the run was planned with. */
  playbook_ids: string[];
}

/** Working data kept on the run until its allocation is finalized. */
export interface StoredAllocation {
  reserve?: { name: string; domain: string; reason: string }[];
  targetedIds?: string[];
}

const RUN_COLS = `id, goal, offer_id, icp, status, requested, total, done, verified, error, created_at, finished_at,
  preference_id, preference_revision, allocation, playbook_ids`;
const PROSPECT_COLS = `id, run_id, company_name, domain, website_url, reason, status, summary,
  industry, location, fit_score, stars, score_parts, evidence, opportunity, unknowns, emails,
  pages, error, lead_id, created_at, updated_at,
  city, region, country, size_band, triggers, timezone, mail_provider, company_key,
  attr_model, attr_prompt_version, via_preference`;

interface ProspectRow {
  id: string;
  company_name: string;
  domain: string;
  status: string;
  emails: ProspectEmail[];
  fit_score: number | null;
  stars: number | null;
  website_url: string | null;
  lead_id: string | null;
  city: string | null;
  region: string | null;
  country: string | null;
  mail_provider: string | null;
}

/** What reading one company's site gave: pages to verify against, or the reason it stopped. */
export type Gathered =
  | {
      kind: 'ok';
      homeUrl: string;
      fetchedUrls: string[];
      pages: { url: string; text: string }[];
      emails: ProspectEmail[];
      skippedNote: string | null;
      skippedPages: number;
    }
  | {
      kind: 'stop';
      reason: 'robots_disallowed' | 'unreachable' | 'safety_blocked';
      /** The columns to save on the prospect. */
      fields: Record<string, unknown>;
    };

@Injectable()
export class ProspectsService {
  private readonly logger = new Logger(ProspectsService.name);
  io: ProspectIO = {
    fetchPage,
    hasMx,
    // resolved lazily: `this.mailProviders` is injected after field init
    mailProvider: (d) => this.mailProviders.lookupDomain(d),
  };

  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    @InjectQueue(PROSPECT_QUEUE) private readonly queue: Queue,
    private readonly ai: AiService,
    private readonly leads: LeadsService,
    private readonly segments: SegmentsService,
    private readonly usage: UsageService,
    private readonly mailProviders: MailProviderService,
    private readonly offers: OffersService,
    private readonly native: NativeDiscoverDriver,
    private readonly agent: AgentDiscoverDriver,
    private readonly cache: DiscoverRunCache,
    private readonly config: ConfigService,
    private readonly playbooks: PlaybooksService,
    @Optional()
    @Inject(SAFETY_SCREEN)
    private readonly safety?: SafetyScreen,
  ) {}

  /** True when Model Armor blocks this page text (or can't be asked, fail-closed). */
  private async pageIsUnsafe(text: string): Promise<boolean> {
    if (!this.safety) return false;
    try {
      const r = await screenInputChunked(this.safety, text, 'web_page');
      return r.verdict === 'blocked';
    } catch (e) {
      this.logger.warn(
        `safety check unavailable, page skipped: ${e instanceof Error ? e.message : String(e)}`,
      );
      return true;
    }
  }

  /**
   * Searches left queued/running by a restart or crash never finish on their
   * own: mark them failed (and their half-checked companies) so the page and
   * the one-search-at-a-time rule don't wait on them forever.
   */
  private async sweepStale(c: PoolClient) {
    const stale = await c.query<{ id: string }>(
      `UPDATE prospect_runs SET status = 'failed', finished_at = now(),
         error = 'Interrupted (the server restarted). Start the search again.'
       WHERE status IN ('queued','running')
         AND created_at < now() - make_interval(mins => $1)
       RETURNING id`,
      [STALE_RUN_MINUTES],
    );
    if (stale.rowCount) {
      await c.query(
        `UPDATE prospects SET status = 'unverified', updated_at = now(),
           error = 'Not checked: the search was interrupted'
         WHERE run_id = ANY($1::uuid[]) AND status IN ('pending','researching')`,
        [stale.rows.map((r) => r.id)],
      );
    }
  }

  private run<T>(orgId: string, fn: (c: PoolClient) => Promise<T>) {
    return withOrgContext(this.pool, orgId, fn);
  }

  // ── API ─────────────────────────────────────────────────────────────────

  async startRun(
    orgId: string,
    userId: string,
    goal: string,
    count = 12,
    offerId?: string,
  ) {
    const n = Math.min(MAX_PROSPECTS_PER_RUN, Math.max(3, Math.round(count)));
    const run = await this.run(orgId, async (c) => {
      // Serialise starts per workspace so two clicks can't both pass the
      // busy check, then enforce the plan's monthly search budget.
      await c.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [
        `${orgId}:prospect-run`,
      ]);
      await this.sweepStale(c);
      await this.usage.assertCanAdd(c, orgId, 'prospectSearchesPerMonth');
      const busy = await c.query(
        `SELECT 1 FROM prospect_runs WHERE status IN ('queued','running') LIMIT 1`,
      );
      if (busy.rowCount) {
        throw new ConflictException(
          'A search is already running. Wait for it to finish first.',
        );
      }
      const resolvedOfferId = await this.offers.resolveOfferIdInTx(
        c,
        orgId,
        offerId,
      );
      // T12: pin the offer's active, unexpired search preference (and its
      // revision) now. Later changes (withdraw, expiry) never touch a run that
      // has already started.
      const pref = await c.query<{ id: string; revision: number }>(
        `SELECT id, revision FROM search_preferences
          WHERE offer_id = $1 AND status = 'active' AND expires_at > now()
          FOR SHARE`,
        [resolvedOfferId],
      );
      const r = await c.query<RunRow>(
        `INSERT INTO prospect_runs
           (org_id, created_by, goal, requested, offer_id, preference_id, preference_revision)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING ${RUN_COLS}`,
        [
          orgId,
          userId,
          goal.trim(),
          n,
          resolvedOfferId,
          pref.rows[0]?.id ?? null,
          pref.rows[0]?.revision ?? null,
        ],
      );
      return r.rows[0];
    });
    try {
      await this.queue.add(
        'run',
        { orgId, runId: run.id },
        { removeOnComplete: true, removeOnFail: 50, attempts: 1 },
      );
    } catch (err) {
      // e.g. Redis down or over its quota: don't leave a run "queued" forever
      await this.run(orgId, (c) =>
        c.query(
          `UPDATE prospect_runs SET status = 'failed', finished_at = now(),
             error = 'Could not start the search. Try again in a minute.'
           WHERE id = $1`,
          [run.id],
        ),
      );
      this.logger.warn(
        `prospect run ${run.id} not queued: ${err instanceof Error ? err.message : String(err)}`,
      );
      throw new ServiceUnavailableException(
        'Could not start the search right now. Try again in a minute.',
      );
    }
    return run;
  }

  listRuns(orgId: string) {
    return this.run(orgId, async (c) => {
      await this.sweepStale(c);
      return (
        await c.query<RunRow>(
          `SELECT ${RUN_COLS} FROM prospect_runs ORDER BY created_at DESC LIMIT 20`,
        )
      ).rows;
    });
  }

  async getRun(orgId: string, runId: string) {
    const out = await this.getRunRow(orgId, runId);
    // T14: "Used 2 playbooks" (titles resolved outside the run's transaction)
    return {
      ...out,
      playbooks_used: await this.playbooks.titles(
        orgId,
        out.playbook_ids ?? [],
      ),
    };
  }

  private getRunRow(orgId: string, runId: string) {
    return this.run(orgId, async (c) => {
      const r = await c.query<RunRow>(
        `SELECT ${RUN_COLS} FROM prospect_runs WHERE id = $1`,
        [runId],
      );
      if (!r.rows[0]) throw new NotFoundException('Search not found');
      const p = await c.query(
        `SELECT ${PROSPECT_COLS} FROM prospects WHERE run_id = $1
         ORDER BY (status = 'verified') DESC, fit_score DESC NULLS LAST, company_name`,
        [runId],
      );
      const al = r.rows[0].allocation;
      return {
        ...r.rows[0],
        allocation_line: al ? allocationLine(al) : null,
        // T10: what the Discover agent is doing (only when that driver is switched on)
        agent_steps:
          this.driverName() === 'agent' ? await this.cache.steps(runId) : [],
        prospects: p.rows,
      };
    });
  }

  /**
   * Verified prospects with a real on-site email become leads (source
   * "expelly"), collected in a manual segment ready for the campaign builder.
   */
  async addToLeads(orgId: string, prospectIds: string[], segmentName?: string) {
    if (!prospectIds.length) throw new BadRequestException('Pick prospects');
    const rows = await this.run(
      orgId,
      async (c) =>
        (
          await c.query<ProspectRow>(
            `SELECT ${PROSPECT_COLS} FROM prospects WHERE id = ANY($1::uuid[])`,
            [prospectIds],
          )
        ).rows,
    );
    // Resolve the segment BEFORE creating leads: an existing manual segment
    // with this name is reused (two adds in the same minute, or adding more
    // to a named list), so leads never end up outside any segment.
    const name = (
      segmentName?.trim() ||
      `Expelly · ${new Date().toISOString().slice(0, 19).replace('T', ' ')}`
    ).slice(0, 80);
    const seg = await this.resolveSegment(orgId, name);
    const leadIds: string[] = [];
    const skipped: { domain: string; reason: string }[] = [];
    for (const p of rows) {
      if (p.status !== 'verified') {
        skipped.push({ domain: p.domain, reason: 'not verified' });
        continue;
      }
      const best =
        p.emails.find((e) => e.onCompanyDomain && e.mx) ??
        p.emails.find((e) => e.mx);
      if (!best) {
        skipped.push({
          domain: p.domain,
          reason: 'no public email on its site',
        });
        continue;
      }
      let leadId = p.lead_id;
      if (!leadId) {
        try {
          const lead = (await this.leads.create(orgId, {
            email: best.email,
            company: p.company_name.slice(0, 200),
            source: 'expelly',
            custom: {
              website: p.website_url ?? `https://${p.domain}`,
              expellyStars: p.stars,
              expellyFitScore: p.fit_score,
              // factors the learning loop reads (verified on the company's site)
              ...(p.city ? { city: p.city } : {}),
              ...(p.region ? { region: p.region } : {}),
              ...(p.country ? { country: p.country } : {}),
            },
          })) as { id: string };
          leadId = lead.id;
          if (p.mail_provider) {
            const provider = p.mail_provider;
            await this.run(orgId, (c) =>
              c.query(
                `UPDATE leads SET mail_provider = $2 WHERE id = $1 AND mail_provider IS NULL`,
                [lead.id, provider],
              ),
            );
          }
        } catch (e) {
          // already a lead (same email): reuse it
          const existing = await this.run(
            orgId,
            async (c) =>
              (
                await c.query<{ id: string }>(
                  `SELECT id FROM leads WHERE lower(email) = lower($1) LIMIT 1`,
                  [best.email],
                )
              ).rows[0],
          );
          if (!existing) {
            skipped.push({
              domain: p.domain,
              reason: e instanceof Error ? e.message : 'could not add',
            });
            continue;
          }
          leadId = existing.id;
        }
        await this.run(orgId, (c) =>
          c.query(
            `UPDATE prospects SET lead_id = $2, status = 'verified', updated_at = now() WHERE id = $1`,
            [p.id, leadId],
          ),
        );
      }
      leadIds.push(leadId);
    }
    if (!leadIds.length) return { added: 0, skipped, segment: null };
    await this.segments.addMembers(orgId, seg.id, leadIds);
    return {
      added: leadIds.length,
      skipped,
      segment: { id: seg.id, name: seg.name },
    };
  }

  // ── worker ──────────────────────────────────────────────────────────────

  async process(orgId: string, runId: string) {
    const run = await this.run(orgId, async (c) => {
      // a finished/failed run is never redone (e.g. a stale job re-delivered)
      const r = await c.query<RunRow>(
        `UPDATE prospect_runs SET status = 'running'
         WHERE id = $1 AND status IN ('queued','running') RETURNING ${RUN_COLS}`,
        [runId],
      );
      return r.rows[0];
    });
    if (!run) return;
    try {
      const offer = await this.offer(orgId);
      // Restarted mid-run (deploy/crash): the companies are already chosen.
      // Don't pay for the AI planning call again; finish the unchecked ones.
      const resumed = await this.run(
        orgId,
        async (c) =>
          (
            await c.query<{
              id: string;
              company_name: string;
              domain: string;
              status: string;
            }>(
              `SELECT id, company_name, domain, status FROM prospects WHERE run_id = $1`,
              [runId],
            )
          ).rows,
      );
      if (resumed.length) {
        const todo = resumed
          .filter((p) => p.status === 'pending' || p.status === 'researching')
          .map((p) => ({ id: p.id, name: p.company_name, domain: p.domain }));
        const icp = run.icp as Record<string, unknown> | null;
        await this.researchAll(
          orgId,
          run,
          typeof icp?.summary === 'string' ? icp.summary : run.goal,
          offer,
          todo,
        );
        await this.finalizeAllocation(
          orgId,
          run,
          typeof icp?.summary === 'string' ? icp.summary : run.goal,
          offer,
        );
        await this.finishRun(orgId, runId);
        return;
      }
      // T12: a run that pinned a search preference plans two searches
      if (
        run.preference_id &&
        (await this.processWithPreference(orgId, run, offer))
      ) {
        await this.finishRun(orgId, runId);
        return;
      }
      const planned = await this.planSearch(orgId, run, offer, {
        mode: 'baseline',
        count: run.requested,
        askFor: Math.ceil(run.requested * 1.5),
        limit: run.requested,
      });
      const candidates = planned.candidates;
      const icp = planned.icp;
      const prospects = await this.run(orgId, async (c) => {
        await c.query(
          `UPDATE prospect_runs SET icp = $2::jsonb, total = $3 WHERE id = $1`,
          [runId, JSON.stringify(icp), candidates.length],
        );
        const out: { id: string; name: string; domain: string }[] = [];
        for (const cand of candidates) {
          const r = await c.query<{ id: string }>(
            `INSERT INTO prospects (org_id, run_id, company_name, domain, reason)
             VALUES ($1, $2, $3, $4, $5)
             ON CONFLICT (run_id, domain) DO NOTHING RETURNING id`,
            [orgId, runId, cand.name, cand.domain, cand.reason],
          );
          if (r.rows[0]) out.push({ id: r.rows[0].id, ...cand });
        }
        return out;
      });

      const icpSummary =
        typeof icp?.summary === 'string' ? icp.summary : run.goal;
      await this.researchAll(orgId, run, icpSummary, offer, prospects);
      await this.finishRun(orgId, runId);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`prospect run ${runId} failed: ${msg}`);
      await this.run(orgId, (c) =>
        c.query(
          `UPDATE prospect_runs SET status = 'failed', error = $2, finished_at = now() WHERE id = $1`,
          [runId, msg.slice(0, 300)],
        ),
      );
    }
  }

  /**
   * Check companies RESEARCH_CONCURRENCY at a time. Each one is isolated (an
   * error or a slow site only affects that company) and capped at
   * PROSPECT_DEADLINE_MS; progress is recounted from the rows, so a resumed
   * run can't show more done than total.
   */
  private async researchAll(
    orgId: string,
    run: RunRow,
    icpSummary: string,
    offer: Offer,
    prospects: { id: string; name: string; domain: string }[],
  ) {
    let next = 0;
    const worker = async () => {
      while (next < prospects.length) {
        const p = prospects[next++];
        let timer: NodeJS.Timeout | undefined;
        try {
          await Promise.race([
            this.researchOne(
              orgId,
              run,
              icpSummary,
              offer,
              p,
              this.driverName() === 'agent'
                ? await this.cache.getClaim(run.id, p.domain)
                : null,
            ),
            new Promise<never>((_, reject) => {
              timer = setTimeout(
                () => reject(new Error('Checking this website took too long')),
                PROSPECT_DEADLINE_MS,
              );
            }),
          ]);
        } catch (err) {
          await this.save(orgId, p.id, {
            status: 'unverified',
            error: (err instanceof Error ? err.message : 'Check failed').slice(
              0,
              200,
            ),
          }).catch(() => undefined);
        } finally {
          clearTimeout(timer);
        }
        await this.recount(orgId, run.id);
      }
    };
    await Promise.all(
      Array.from({ length: RESEARCH_CONCURRENCY }, () => worker()),
    );
  }

  private recount(orgId: string, runId: string) {
    return this.run(orgId, (c) =>
      c.query(
        `UPDATE prospect_runs SET
           total = (SELECT count(*) FROM prospects WHERE run_id = $1),
           done = (SELECT count(*) FROM prospects WHERE run_id = $1
                     AND status NOT IN ('pending','researching')),
           verified = (SELECT count(*) FROM prospects WHERE run_id = $1 AND status = 'verified')
         WHERE id = $1`,
        [runId],
      ),
    );
  }

  private async finishRun(orgId: string, runId: string) {
    await this.recount(orgId, runId);
    await this.run(orgId, (c) =>
      c.query(
        `UPDATE prospect_runs SET status = 'done', finished_at = now() WHERE id = $1`,
        [runId],
      ),
    );
  }

  /** Existing manual segment with this name, else a new one. */
  private async resolveSegment(
    orgId: string,
    name: string,
  ): Promise<{ id: string; name: string }> {
    const find = () =>
      this.run(
        orgId,
        async (c) =>
          (
            await c.query<{ id: string; name: string }>(
              `SELECT id, name FROM segments
               WHERE lower(name) = lower($1) AND type = 'manual' LIMIT 1`,
              [name],
            )
          ).rows[0],
      );
    const existing = await find();
    if (existing) return existing;
    try {
      return await this.segments.create(orgId, {
        name,
        type: 'manual',
      });
    } catch (e) {
      // created concurrently: use that one
      const again = await find();
      if (again) return again;
      throw e;
    }
  }

  // ── T12: a run with a search preference ─────────────────────────────────

  /** `DISCOVER_DRIVER`: native (default, today's pipeline) or agent (the ADK Discover agent, T10). */
  private driverName(): DiscoverDriverName {
    return this.config.get<string>('DISCOVER_DRIVER')?.trim().toLowerCase() ===
      'agent'
      ? 'agent'
      : 'native';
  }

  /**
   * Plans one search (the ICP and candidate companies). In agent mode a single A2A call does the
   * planning, finding and first check; if the agent cannot answer the API falls back to the native
   * pipeline for that call, so a run never depends on the agent being up.
   */
  private async planSearch(
    orgId: string,
    run: RunRow,
    offer: Offer,
    p: {
      mode: 'baseline' | 'targeted';
      count: number;
      askFor: number;
      limit: number;
      preference?: PlanInput['preference'];
    },
  ): Promise<PlanResult> {
    const base: PlanInput = {
      orgId,
      runId: run.id,
      goal: run.goal,
      offer,
      offerRef: { id: run.offer_id ?? 'none', name: 'Offer' },
      mode: p.mode,
      count: p.count,
      askFor: p.askFor,
      limit: p.limit,
      preference: p.preference,
      excludeCompanyKeys: [],
    };
    // T14: approved audience learnings for this offer, as hints. Never throws and never blocks a run.
    const hints = await this.playbooks.relevant(orgId, {
      offerId: run.offer_id,
      text: [run.goal, offer.offer, offer.audience].filter(Boolean).join('. '),
      kinds: ['audience'],
    });
    if (hints.length > 0) {
      base.playbooks = hints;
      await this.run(orgId, (c) =>
        c.query(
          `UPDATE prospect_runs SET playbook_ids = $2::jsonb WHERE id = $1`,
          [run.id, JSON.stringify(hints.map((h) => h.id))],
        ),
      ).catch(() => undefined);
    }
    if (this.driverName() === 'agent') {
      try {
        const ref = await this.run(
          orgId,
          async (c) =>
            (
              await c.query<{
                id: string;
                name: string;
                description: string | null;
              }>(`SELECT id, name, description FROM offers WHERE id = $1`, [
                run.offer_id,
              ])
            ).rows[0],
        );
        if (ref) {
          base.offerRef = {
            id: ref.id,
            name: ref.name,
            ...(ref.description ? { description: ref.description } : {}),
          };
        }
        base.excludeCompanyKeys = [...(await this.knownCompanies(orgId, run))];
        const r = await this.agent.plan(base);
        return { icp: r.icp, candidates: r.candidates };
      } catch (e) {
        this.logger.warn(
          `Discover agent unavailable for run ${run.id}, using the standard search: ${e instanceof Error ? e.message : String(e)}`,
        );
        await this.cache.pushStep(
          run.id,
          'The agent could not answer, so the standard search is used instead.',
        );
      }
    }
    return this.native.plan(base);
  }

  /** Companies this workspace already knows: earlier searches of the offer, and leads. */
  private async knownCompanies(
    orgId: string,
    run: Pick<RunRow, 'id' | 'offer_id'>,
  ): Promise<Set<string>> {
    const rows = await this.run(
      orgId,
      async (c) =>
        (
          await c.query<{ k: string }>(
            `SELECT lower(COALESCE(p.company_key, p.domain)) AS k
               FROM prospects p JOIN prospect_runs r ON r.id = p.run_id
              WHERE r.offer_id IS NOT DISTINCT FROM $1 AND p.run_id <> $2
             UNION
             SELECT lower(company_key) FROM leads WHERE company_key IS NOT NULL`,
            [run.offer_id, run.id],
          )
        ).rows,
    );
    return new Set(rows.map((r) => r.k));
  }

  /**
   * Plans a run that reserves a share of its slots for a search preference:
   * a normal (baseline) search plus a second, constrained one, deduped by
   * company. Returns false when the preference cannot be used (the caller then
   * runs the normal search).
   */
  private async processWithPreference(
    orgId: string,
    run: RunRow,
    offer: Offer,
  ): Promise<boolean> {
    const pref = await this.run(
      orgId,
      async (c) =>
        (
          await c.query<{
            factor: string;
            value: string;
            label: string;
            cap_share: string;
          }>(
            `SELECT factor, value, label, cap_share FROM search_preferences WHERE id = $1`,
            [run.preference_id],
          )
        ).rows[0],
    );
    if (!pref || !isSearchFactor(pref.factor)) return false;
    const capShare = Number(pref.cap_share);
    const cap = reservedSlots(run.requested, capShare);
    const base: Allocation = {
      batchSize: run.requested,
      cap,
      capShare,
      factor: pref.factor,
      value: pref.value,
      label: pref.label,
      targetedRequested: 0,
      targetedFound: 0,
      targetedKept: 0,
      shortfall: 0,
      baselineFilled: 0,
      dedupedOverlap: 0,
    };
    if (cap < 1) {
      await this.run(orgId, (c) =>
        c.query(
          `UPDATE prospect_runs SET allocation = $2::jsonb WHERE id = $1`,
          [
            run.id,
            JSON.stringify({
              ...base,
              skipped:
                'the batch is too small to reserve a slot (a preference needs a batch of at least 5 companies).',
              finalized: true,
            }),
          ],
        ),
      );
      return false;
    }

    // 1. the normal search, with room to spare for filling
    const basePlan = await this.planSearch(orgId, run, offer, {
      mode: 'baseline',
      count: Math.min(50, run.requested + cap),
      askFor: Math.ceil(run.requested * 1.5),
      limit: Math.ceil(run.requested * 1.5),
    });
    const baselineAll = basePlan.candidates;
    const icp = basePlan.icp;

    // 2. the constrained search; if it fails the batch is filled normally
    let targetedAll: { name: string; domain: string; reason: string }[] = [];
    try {
      targetedAll = (
        await this.planSearch(orgId, run, offer, {
          mode: 'targeted',
          count: Math.min(cap * 2, 8),
          askFor: Math.min(cap * 2, 8),
          limit: Math.min(cap * 2, 8),
          preference: {
            id: run.preference_id ?? '',
            revision: run.preference_revision ?? 1,
            factor: pref.factor,
            value: pref.value,
            condition: describeFilter(pref.factor, pref.value),
          },
        })
      ).candidates;
    } catch (e) {
      this.logger.warn(
        `targeted search failed for run ${run.id}, filling from the normal search: ${e instanceof Error ? e.message : String(e)}`,
      );
    }

    // 3. dedupe: against what we already know, then across the two lists
    //    (a company in both counts once, as targeted)
    const known = await this.knownCompanies(orgId, run);
    const fresh = <T extends { domain: string }>(xs: T[]) =>
      xs.filter(
        (x) =>
          !known.has((companyKey(null, x.domain) ?? x.domain).toLowerCase()),
      );
    const targeted = fresh(targetedAll).slice(0, cap * 2);
    const tDomains = new Set(targeted.map((t) => t.domain));
    const baselineFresh = fresh(baselineAll);
    const overlap = baselineFresh.filter((b) => tDomains.has(b.domain)).length;
    const baselineFree = baselineFresh.filter((b) => !tDomains.has(b.domain));
    const mainSize = Math.max(0, run.requested - cap);
    const main = baselineFree.slice(0, mainSize);
    const reserve = baselineFree.slice(mainSize, mainSize + cap);

    // 4. save the plan and check every company on its own website
    const toCheck = await this.run(orgId, async (c) => {
      const insert = async (
        list: { name: string; domain: string; reason: string }[],
      ) => {
        const out: { id: string; name: string; domain: string }[] = [];
        for (const cand of list) {
          const r = await c.query<{ id: string }>(
            `INSERT INTO prospects (org_id, run_id, company_name, domain, reason)
             VALUES ($1, $2, $3, $4, $5)
             ON CONFLICT (run_id, domain) DO NOTHING RETURNING id`,
            [orgId, run.id, cand.name, cand.domain, cand.reason],
          );
          if (r.rows[0]) out.push({ id: r.rows[0].id, ...cand });
        }
        return out;
      };
      const t = await insert(targeted);
      const m = await insert(main);
      const stored: Allocation & StoredAllocation = {
        ...base,
        targetedRequested: targeted.length,
        dedupedOverlap: overlap,
        reserve,
        targetedIds: t.map((x) => x.id),
        finalized: false,
      };
      await c.query(
        `UPDATE prospect_runs SET icp = $2::jsonb, total = $3, allocation = $4::jsonb WHERE id = $1`,
        [
          run.id,
          JSON.stringify(icp),
          t.length + m.length,
          JSON.stringify(stored),
        ],
      );
      return [...t, ...m];
    });
    const icpSummary =
      typeof icp?.summary === 'string' ? icp.summary : run.goal;
    await this.researchAll(orgId, run, icpSummary, offer, toCheck);
    await this.finalizeAllocation(orgId, run, icpSummary, offer);
    return true;
  }

  /**
   * After the checks: a targeted company counts only if its own website
   * confirms the factor. Keep up to `cap` of them (best fit first), record any
   * shortfall, and fill it from the reserve of normal candidates. Safe to call
   * twice (a restarted run calls it again).
   */
  private async finalizeAllocation(
    orgId: string,
    run: RunRow,
    icpSummary: string,
    offer: Offer,
  ) {
    const al = await this.run(
      orgId,
      async (c) =>
        (
          await c.query<{ allocation: (Allocation & StoredAllocation) | null }>(
            `SELECT allocation FROM prospect_runs WHERE id = $1`,
            [run.id],
          )
        ).rows[0]?.allocation ?? null,
    );
    if (!al || al.finalized) return;

    const rows = await this.run(
      orgId,
      async (c) =>
        (
          await c.query<{
            id: string;
            status: string;
            city: string | null;
            region: string | null;
            country: string | null;
            industry: string | null;
            size_band: string | null;
            triggers: unknown;
          }>(
            `SELECT id, status, city, region, country, industry, size_band, triggers
               FROM prospects WHERE id = ANY($1::uuid[])
              ORDER BY fit_score DESC NULLS LAST, company_name`,
            [al.targetedIds ?? []],
          )
        ).rows,
    );
    const matching = rows.filter((r) => matchesFactor(al.factor, al.value, r));
    const kept = matching.slice(0, al.cap);
    const shortfall = al.cap - kept.length;
    const fill = (al.reserve ?? []).slice(0, Math.max(0, shortfall));

    const filled = await this.run(orgId, async (c) => {
      if (kept.length) {
        await c.query(
          `UPDATE prospects SET via_preference = true, updated_at = now()
            WHERE id = ANY($1::uuid[])`,
          [kept.map((k) => k.id)],
        );
      }
      const out: { id: string; name: string; domain: string }[] = [];
      for (const cand of fill) {
        const r = await c.query<{ id: string }>(
          `INSERT INTO prospects (org_id, run_id, company_name, domain, reason)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (run_id, domain) DO NOTHING RETURNING id`,
          [orgId, run.id, cand.name, cand.domain, cand.reason],
        );
        if (r.rows[0]) out.push({ id: r.rows[0].id, ...cand });
      }
      return out;
    });
    if (filled.length) {
      await this.researchAll(orgId, run, icpSummary, offer, filled);
    }

    const final: Allocation & StoredAllocation = {
      ...al,
      targetedFound: matching.length,
      targetedKept: kept.length,
      shortfall,
      baselineFilled: filled.length,
      finalized: true,
    };
    delete final.reserve;
    await this.run(orgId, (c) =>
      c.query(`UPDATE prospect_runs SET allocation = $2::jsonb WHERE id = $1`, [
        run.id,
        JSON.stringify(final),
      ]),
    );
  }

  private async offer(orgId: string): Promise<Offer> {
    return this.run(orgId, async (c) => {
      const r = await c.query<Offer & { pain_points: string | null }>(
        `SELECT description, offer, audience, pain_points FROM org_knowledge LIMIT 1`,
      );
      const k = r.rows[0];
      return k ? { ...k, painPoints: k.pain_points } : {};
    });
  }

  private async save(
    orgId: string,
    id: string,
    fields: Record<string, unknown>,
  ) {
    const keys = Object.keys(fields);
    const sets = keys.map((k, i) => `${k} = $${i + 2}`).join(', ');
    await this.run(orgId, (c) =>
      c.query(
        `UPDATE prospects SET ${sets}, updated_at = now() WHERE id = $1`,
        [
          id,
          ...keys.map((k) => {
            const v = fields[k];
            return v !== null && typeof v === 'object' ? JSON.stringify(v) : v;
          }),
        ],
      ),
    );
  }

  /**
   * Read ONE company's own website, safely: robots.txt, the SSRF-guarded fetch, page limits, Model
   * Armor, and the emails that literally appear on the pages. Shared by the native research and by
   * the Discover agent's tool endpoint (T10): there is exactly one way the API reads the web.
   */
  async gatherCompany(domain: string): Promise<Gathered> {
    // robots.txt first (unreachable robots = no rules)
    let rules: string[] = [];
    try {
      const r = await this.io.fetchPage(`https://${domain}/robots.txt`);
      if (r.status === 200) rules = parseRobots(r.html);
    } catch {
      /* no robots */
    }
    if (!robotsAllows(rules, '/')) {
      return {
        kind: 'stop',
        reason: 'robots_disallowed',
        fields: {
          status: 'unreachable',
          error: "The site's robots.txt asks bots not to read it",
        },
      };
    }

    let home: FetchedPage | null = null;
    for (const url of [`https://${domain}/`, `https://www.${domain}/`]) {
      try {
        const r = await this.io.fetchPage(url);
        if (r.status >= 200 && r.status < 300 && r.html.length > 200) {
          home = r;
          break;
        }
      } catch {
        /* try next */
      }
    }
    if (!home) {
      return {
        kind: 'stop',
        reason: 'unreachable',
        fields: {
          status: 'unreachable',
          error:
            "Couldn't open the website (offline, blocked, or not a real site)",
        },
      };
    }

    const fetched: FetchedPage[] = [home];
    for (const url of subpageLinks(home.html, home.url, 4)) {
      if (!robotsAllows(rules, new URL(url).pathname)) continue;
      try {
        const r = await this.io.fetchPage(url);
        if (r.status >= 200 && r.status < 300) fetched.push(r);
      } catch {
        /* skip */
      }
    }

    let budget = TOTAL_TEXT_LIMIT;
    const readable = fetched
      .map((f) => {
        const head = [pageTitle(f.html), metaDescription(f.html)]
          .filter(Boolean)
          .join(' | ');
        const text = `${head}\n${htmlToText(f.html)}`.slice(
          0,
          Math.min(PAGE_TEXT_LIMIT, Math.max(0, budget)),
        );
        budget -= text.length;
        return { url: f.url, text };
      })
      .filter((pg) => pg.text.trim().length > 40);

    // Model Armor: a page with prompt injection never reaches Gemini. A
    // blocked page is dropped from the evidence and counted on the prospect.
    const pages: typeof readable = [];
    let skippedPages = 0;
    for (const pg of readable) {
      if (await this.pageIsUnsafe(pg.text)) skippedPages += 1;
      else pages.push(pg);
    }
    const skippedNote =
      skippedPages > 0
        ? `${skippedPages} page${skippedPages === 1 ? '' : 's'} skipped by safety check`
        : null;
    if (skippedPages > 0 && pages.length === 0) {
      return {
        kind: 'stop',
        reason: 'safety_blocked',
        fields: {
          status: 'unverified',
          website_url: home.url,
          pages: fetched.map((f) => f.url),
          error: skippedNote,
        },
      };
    }

    // Real emails only: exactly as they appear on the company's pages.
    const host = domain;
    // acme.com may redirect to acme-group.com: its addresses are own too
    const finalHost = new URL(home.url).hostname
      .toLowerCase()
      .replace(/^www\./, '');
    const found = new Map<string, string>();
    for (const f of fetched) {
      for (const e of extractEmails(f.html))
        if (!found.has(e)) found.set(e, f.url);
    }
    // Keep the company's own domain, or a free mailbox (small local
    // businesses); other domains on the page are usually vendors/agencies.
    const emails: ProspectEmail[] = [];
    for (const [email, url] of found) {
      const d = email.split('@')[1];
      const own =
        d === host ||
        d.endsWith(`.${host}`) ||
        d === finalHost ||
        d.endsWith(`.${finalHost}`);
      if (!own && !FREE_MAIL.test(d)) continue;
      emails.push({
        email,
        url,
        onCompanyDomain: own,
        mx: await this.io.hasMx(d),
      });
      if (emails.length >= 8) break;
    }

    return {
      kind: 'ok',
      homeUrl: home.url,
      fetchedUrls: fetched.map((f) => f.url),
      pages,
      emails,
      skippedNote,
      skippedPages,
    };
  }

  /**
   * The pages an agent-driven run already read (the tool endpoint cached them), so the quotes the
   * agent sends back are checked against the SAME text. A cache miss simply reads the site again.
   */
  private async cachedGather(
    runId: string,
    domain: string,
  ): Promise<Gathered | null> {
    const c = await this.cache.getPages(runId, domain);
    if (!c) return null;
    return {
      kind: 'ok',
      homeUrl: c.homeUrl,
      fetchedUrls: c.fetchedUrls,
      pages: c.pages,
      emails: c.emails,
      skippedNote: c.skippedNote,
      skippedPages: c.skippedNote ? 1 : 0,
    };
  }

  /** What the Discover agent's `fetch_company_pages` tool gets (T10). */
  async fetchPagesForAgent(orgId: string, runId: string, domain: string) {
    const run = await this.run(
      orgId,
      async (c) =>
        (
          await c.query<{ status: string }>(
            `SELECT status FROM prospect_runs WHERE id = $1`,
            [runId],
          )
        ).rows[0],
    );
    if (!run) throw new NotFoundException('Search not found');
    if (run.status !== 'queued' && run.status !== 'running') {
      throw new ConflictException({
        statusCode: 409,
        error: 'run_not_active',
        message: 'This search is not running.',
      });
    }
    const d = normalizeDomain(domain);
    if (!d) throw new BadRequestException('That is not a website domain');
    if ((await this.cache.countFetch(runId)) > MAX_AGENT_FETCHES_PER_RUN) {
      throw new HttpException(
        {
          statusCode: 429,
          error: 'run_limit',
          message: `A search may read at most ${MAX_AGENT_FETCHES_PER_RUN} companies.`,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    await this.cache.pushStep(runId, `Agent: reading ${d}`);
    const g = await this.gatherCompany(d);
    if (g.kind === 'stop') {
      return { ok: false, domain: d, reason: g.reason, pages: [] };
    }
    await this.cache.setPages(runId, d, {
      homeUrl: g.homeUrl,
      fetchedUrls: g.fetchedUrls,
      pages: g.pages,
      emails: g.emails,
      skippedNote: g.skippedNote,
    });
    return {
      ok: true,
      domain: d,
      finalUrl: g.homeUrl,
      pages: g.pages,
      skippedForSafety: g.skippedPages,
    };
  }

  /**
   * Read the company's own site, then qualify it from those pages: with the API's own AI (native)
   * or from the Discover agent's claim (T10). Either way every quote, location and trigger is
   * verified against the pages here, and the emails come from the pages, never from the model.
   */
  async researchOne(
    orgId: string,
    run: { id?: string; goal: string },
    icpSummary: string,
    offer: Offer,
    p: { id: string; domain: string },
    claim: DiscoverCandidate | null = null,
  ) {
    // the company key is known from the domain alone, whatever happens next
    await this.save(orgId, p.id, {
      status: 'researching',
      company_key: companyKey(null, p.domain),
    });

    let g: Gathered | null =
      claim && run.id ? await this.cachedGather(run.id, p.domain) : null;
    g ??= await this.gatherCompany(p.domain);
    if (g.kind === 'stop') return this.save(orgId, p.id, g.fields);

    let analysis: Record<string, unknown>;
    let model = '';
    let promptVersion = ATTR_PROMPT_VERSION;
    if (claim) {
      analysis = claimToAnalysis(claim);
      model = 'adk-discover';
      promptVersion = AGENT_ATTR_VERSION;
    } else {
      try {
        const res = await this.ai.generate(orgId, 'prospect-research', {
          ...researchPrompt({
            goal: run.goal,
            icpSummary,
            offer,
            domain: p.domain,
            pages: g.pages,
          }),
          task: 'discover_verify_extract',
        });
        analysis = JSON.parse(res.text) as Record<string, unknown>;
        model = res.model;
      } catch (e) {
        return this.save(orgId, p.id, {
          status: 'unverified',
          website_url: g.homeUrl,
          emails: g.emails,
          pages: g.fetchedUrls,
          error: `AI couldn't analyse it: ${e instanceof Error ? e.message.slice(0, 120) : 'error'}`,
        });
      }
    }
    return this.finishCompany(orgId, p, g, analysis, model, promptVersion);
  }

  /** Verify an analysis against the pages and store the company. The same for every driver. */
  private async finishCompany(
    orgId: string,
    p: { id: string; domain: string },
    g: Extract<Gathered, { kind: 'ok' }>,
    analysis: Record<string, unknown>,
    model: string,
    promptVersion: string,
  ) {
    const { pages, emails, skippedNote } = g;
    const evidence = verifyEvidence(analysis.facts, pages);
    // Attributes are verified like evidence: what the pages don't back up is
    // dropped and stays explicit (null / unknown). Timezone is code-derived.
    const loc = verifyLocation(analysis, pages);
    const triggers = verifyTriggers(analysis.triggers, pages);
    const mailProvider = this.io.mailProvider
      ? await this.io.mailProvider(p.domain)
      : 'unknown';
    const score = scoreProspect(analysis.scores ?? {}, emails);
    const real = analysis.isRealBusinessSite !== false && evidence.length > 0;
    const str = (k: string, max: number) =>
      typeof analysis[k] === 'string' ? analysis[k].trim().slice(0, max) : null;
    await this.save(orgId, p.id, {
      status: real ? 'verified' : 'rejected',
      website_url: g.homeUrl,
      company_name: str('companyName', 200) || (await this.nameOf(orgId, p.id)),
      summary: str('summary', 600),
      industry: cleanIndustry(analysis.industry),
      location: str('location', 120),
      city: loc.city,
      region: loc.region,
      country: loc.country,
      timezone: loc.timezone,
      size_band: cleanSizeBand(analysis.sizeBand),
      triggers,
      mail_provider: mailProvider,
      attr_model: model,
      attr_prompt_version: promptVersion,
      evidence,
      opportunity: cleanOpportunity(analysis.opportunity),
      unknowns: [
        ...cleanUnknowns(analysis.unknowns),
        ...(skippedNote ? [skippedNote] : []),
      ],
      emails,
      pages: g.fetchedUrls,
      fit_score: real ? score.total : null,
      stars: real ? score.stars : null,
      score_parts: real ? score.parts : null,
      error: real
        ? null
        : "The website didn't back this company up (no verifiable facts)",
    });
  }

  private async nameOf(orgId: string, id: string) {
    return this.run(
      orgId,
      async (c) =>
        (
          await c.query<{ company_name: string }>(
            `SELECT company_name FROM prospects WHERE id = $1`,
            [id],
          )
        ).rows[0]?.company_name ?? '',
    );
  }
}
