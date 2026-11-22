import { Logger } from '@nestjs/common';
import { type EmbeddingProvider, tokens } from './embedding.provider';
import type { PlaybookVectorStore } from './vector-store';

/**
 * Finds the playbooks most relevant to a request (Learning Loop T14). A
 * retriever only returns ORDERED IDS: the service loads each one from
 * Postgres and re-checks workspace, offer, status and expiry there, so a
 * stale or wrong vector can never put the wrong text in front of a model.
 */
export interface RetrieveQuery {
  orgId: string;
  offerId: string;
  /** What the request is about: the offer, goal or subject, in words. */
  text: string;
  k: number;
}

export interface PlaybookRetriever {
  readonly name: string;
  retrieve(q: RetrieveQuery): Promise<string[]>;
}

/** Vector search: embed the request as a QUERY, ask the store for the nearest playbooks. */
export class VectorRetriever implements PlaybookRetriever {
  readonly name = 'bigquery';

  constructor(
    private readonly embeddings: EmbeddingProvider,
    private readonly store: PlaybookVectorStore,
  ) {}

  async retrieve(q: RetrieveQuery): Promise<string[]> {
    if (!q.text.trim()) return [];
    const embedding = await this.embeddings.embed(q.text, 'RETRIEVAL_QUERY');
    const hits = await this.store.search({
      orgId: q.orgId,
      offerId: q.offerId,
      embedding,
      k: q.k,
    });
    return hits
      .sort((a, b) => a.distance - b.distance)
      .map((h) => h.playbookId);
  }
}

// ── keyword fallback (also PLAYBOOK_SEARCH=postgres) ───────────────────────

const STOP = new Set(
  (
    'the and for with that this from are was were have has had you your our not but can will ' +
    'about into over than then them they their out all any how what when which who why more most ' +
    'per via its it is in on of to a an as at by be or if we'
  ).split(' '),
);

export interface KeywordCandidate {
  id: string;
  title: string;
  body: string;
}

/** Overlap between the request's words and a playbook's words; title words count double. */
export function keywordScore(query: string, doc: KeywordCandidate): number {
  const q = new Set(tokens(query).filter((t) => !STOP.has(t)));
  if (q.size === 0) return 0;
  const title = new Set(tokens(doc.title));
  const body = new Set(tokens(doc.body));
  let score = 0;
  for (const t of q) {
    if (title.has(t)) score += 2;
    else if (body.has(t)) score += 1;
  }
  return score;
}

/** Loads the active, unexpired playbooks of one offer (the service owns the SQL and the tenant context). */
export type LoadCandidates = (
  orgId: string,
  offerId: string,
  opts: { onlyUnindexed: boolean },
) => Promise<KeywordCandidate[]>;

export class KeywordRetriever implements PlaybookRetriever {
  readonly name = 'postgres';

  constructor(private readonly load: LoadCandidates) {}

  async retrieve(
    q: RetrieveQuery,
    opts: { onlyUnindexed?: boolean } = {},
  ): Promise<string[]> {
    const docs = await this.load(q.orgId, q.offerId, {
      onlyUnindexed: opts.onlyUnindexed ?? false,
    });
    return docs
      .map((d) => ({ id: d.id, score: keywordScore(q.text, d) }))
      .filter((d) => d.score > 0)
      .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id))
      .slice(0, q.k)
      .map((d) => d.id);
  }
}

/**
 * Vector search first. If it fails, keywords answer instead (and the failure
 * is logged). Playbooks saved while the vector copy was unavailable have no
 * vector yet, so they are always checked by keyword too and folded in.
 */
export class FallbackRetriever implements PlaybookRetriever {
  private readonly logger = new Logger(FallbackRetriever.name);

  constructor(
    private readonly primary: PlaybookRetriever,
    private readonly keywords: KeywordRetriever,
  ) {}

  get name(): string {
    return this.primary.name;
  }

  async retrieve(q: RetrieveQuery): Promise<string[]> {
    let ids: string[];
    try {
      ids = await this.primary.retrieve(q);
    } catch (e) {
      this.logger.warn(
        `playbooks: ${this.primary.name} search failed, using keywords: ${(e as Error).message}`,
      );
      return this.keywords.retrieve(q);
    }
    const extra = await this.keywords.retrieve(q, { onlyUnindexed: true });
    return [...new Set([...ids, ...extra])].slice(0, q.k);
  }
}
