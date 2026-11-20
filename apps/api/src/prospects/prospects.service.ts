import { InjectQueue } from '@nestjs/bullmq';
import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Queue } from 'bullmq';
import { Pool, PoolClient } from 'pg';
import { AiService } from '../ai/ai.service';
import { PG_POOL } from '../db/db.module';
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
  ATTR_PROMPT_VERSION,
  type Offer,
  icpAndCandidatesPrompt,
  researchPrompt,
} from './prompts';
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
}

const RUN_COLS = `id, goal, offer_id, icp, status, requested, total, done, verified, error, created_at, finished_at`;
const PROSPECT_COLS = `id, run_id, company_name, domain, website_url, reason, status, summary,
  industry, location, fit_score, stars, score_parts, evidence, opportunity, unknowns, emails,
  pages, error, lead_id, created_at, updated_at,
  city, region, country, size_band, triggers, timezone, mail_provider, company_key,
  attr_model, attr_prompt_version`;

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
  ) {}

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
      const r = await c.query<RunRow>(
        `INSERT INTO prospect_runs (org_id, created_by, goal, requested, offer_id)
         VALUES ($1, $2, $3, $4, $5) RETURNING ${RUN_COLS}`,
        [orgId, userId, goal.trim(), n, resolvedOfferId],
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

  getRun(orgId: string, runId: string) {
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
      return { ...r.rows[0], prospects: p.rows };
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
        await this.finishRun(orgId, runId);
        return;
      }
      const res = await this.ai.generate(
        orgId,
        'prospect-icp',
        icpAndCandidatesPrompt(run.goal, offer, Math.ceil(run.requested * 1.5)),
      );
      const parsed = JSON.parse(res.text) as {
        icp?: Record<string, unknown>;
        candidates?: { name?: unknown; domain?: unknown; reason?: unknown }[];
      };
      const seen = new Set<string>();
      const candidates: { name: string; domain: string; reason: string }[] = [];
      for (const c of parsed.candidates ?? []) {
        const domain =
          typeof c.domain === 'string' ? normalizeDomain(c.domain) : null;
        if (!domain || seen.has(domain) || typeof c.name !== 'string') continue;
        seen.add(domain);
        candidates.push({
          name: c.name.trim().slice(0, 200),
          domain,
          reason: typeof c.reason === 'string' ? c.reason.slice(0, 400) : '',
        });
        if (candidates.length >= run.requested) break;
      }
      const icp = parsed.icp ?? null;
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
            this.researchOne(orgId, run, icpSummary, offer, p),
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

  /** Read the company's own site, then let Gemini qualify it from those pages. */
  async researchOne(
    orgId: string,
    run: Pick<RunRow, 'goal'>,
    icpSummary: string,
    offer: Offer,
    p: { id: string; domain: string },
  ) {
    // the company key is known from the domain alone, whatever happens next
    await this.save(orgId, p.id, {
      status: 'researching',
      company_key: companyKey(null, p.domain),
    });

    // robots.txt first (unreachable robots = no rules)
    let rules: string[] = [];
    try {
      const r = await this.io.fetchPage(`https://${p.domain}/robots.txt`);
      if (r.status === 200) rules = parseRobots(r.html);
    } catch {
      /* no robots */
    }
    if (!robotsAllows(rules, '/')) {
      return this.save(orgId, p.id, {
        status: 'unreachable',
        error: "The site's robots.txt asks bots not to read it",
      });
    }

    let home: FetchedPage | null = null;
    for (const url of [`https://${p.domain}/`, `https://www.${p.domain}/`]) {
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
      return this.save(orgId, p.id, {
        status: 'unreachable',
        error:
          "Couldn't open the website (offline, blocked, or not a real site)",
      });
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
    const pages = fetched
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

    // Real emails only: exactly as they appear on the company's pages.
    const host = p.domain;
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

    let analysis: Record<string, unknown>;
    let model = '';
    try {
      const res = await this.ai.generate(
        orgId,
        'prospect-research',
        researchPrompt({
          goal: run.goal,
          icpSummary,
          offer,
          domain: p.domain,
          pages,
        }),
      );
      analysis = JSON.parse(res.text) as Record<string, unknown>;
      model = res.model;
    } catch (e) {
      return this.save(orgId, p.id, {
        status: 'unverified',
        website_url: home.url,
        emails,
        pages: fetched.map((f) => f.url),
        error: `AI couldn't analyse it: ${e instanceof Error ? e.message.slice(0, 120) : 'error'}`,
      });
    }

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
      website_url: home.url,
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
      attr_prompt_version: ATTR_PROMPT_VERSION,
      evidence,
      opportunity: cleanOpportunity(analysis.opportunity),
      unknowns: cleanUnknowns(analysis.unknowns),
      emails,
      pages: fetched.map((f) => f.url),
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
