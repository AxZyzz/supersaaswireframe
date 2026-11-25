import { GoogleGenAI } from '@google/genai';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * Text embeddings for playbook retrieval (Learning Loop T14). A playbook is
 * embedded as a DOCUMENT; a Discover goal or a draft request is embedded as a
 * QUERY, which is how Google's embedding model is meant to be used.
 *
 * EMBEDDING_DRIVER:
 *  - gemini (default when AI_DRIVER=gemini): `gemini-embedding-001` through the
 *    Google GenAI SDK. On Vertex AI when EMBEDDINGS_USE_VERTEX=true (project +
 *    EMBEDDINGS_LOCATION, default us-central1, credentials from the runtime
 *    service account), otherwise with GEMINI_API_KEY (Google AI Studio).
 *  - mock (default otherwise, always in Jest): deterministic word-hash vectors,
 *    no network. Texts that share words land closer together, so retrieval
 *    tests mean something.
 */
export type EmbedTask = 'RETRIEVAL_DOCUMENT' | 'RETRIEVAL_QUERY';

export interface EmbeddingProvider {
  readonly name: string;
  /** Length of every vector it returns. */
  readonly dims: number;
  embed(text: string, task: EmbedTask): Promise<number[]>;
}

export const EMBEDDING_PROVIDER = Symbol('EMBEDDING_PROVIDER');

export const DEFAULT_EMBEDDING_MODEL = 'gemini-embedding-001';
/** 768 of the model's 3072 dimensions (it is trained to be cut): plenty for a few hundred short texts. */
export const DEFAULT_EMBEDDING_DIMS = 768;
/** A playbook is at most ~700 characters; anything longer is not a playbook. */
export const MAX_EMBED_CHARS = 2000;

const finite = (v: unknown): v is number =>
  typeof v === 'number' && Number.isFinite(v);

/** Checks a vector from any source before it is stored or searched with. */
export function assertVector(v: unknown, dims: number): number[] {
  if (!Array.isArray(v) || v.length !== dims || !v.every(finite)) {
    throw new Error(`embedding must be ${dims} finite numbers`);
  }
  return v;
}

/** Lower-cased word tokens (letters and digits, unicode aware). */
export function tokens(text: string): string[] {
  return (text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).filter(
    (t) => t.length > 1,
  );
}

/** FNV-1a: a small stable hash, so the mock gives the same vector every run. */
function hash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

@Injectable()
export class MockEmbeddingProvider implements EmbeddingProvider {
  readonly name = 'mock';

  constructor(readonly dims: number = 64) {}

  embed(text: string): Promise<number[]> {
    const v = new Array<number>(this.dims).fill(0);
    for (const t of tokens(text)) v[hash(t) % this.dims] += 1;
    const norm = Math.sqrt(v.reduce((n, x) => n + x * x, 0)) || 1;
    return Promise.resolve(v.map((x) => x / norm));
  }
}

type EmbedFn = (
  text: string,
  task: EmbedTask,
  dims: number,
  model: string,
) => Promise<unknown>;

@Injectable()
export class GeminiEmbeddingProvider implements EmbeddingProvider {
  readonly name = 'gemini';
  readonly dims: number;
  private readonly model: string;
  private embedFn: EmbedFn | null = null;

  constructor(private readonly config: ConfigService) {
    const d = Number(config.get<string>('EMBEDDING_DIMS'));
    this.dims =
      Number.isInteger(d) && d >= 64 && d <= 3072 ? d : DEFAULT_EMBEDDING_DIMS;
    this.model =
      config.get<string>('EMBEDDING_MODEL') || DEFAULT_EMBEDDING_MODEL;
  }

  /** Test seam: replace the network call. */
  useEmbedFn(fn: EmbedFn) {
    this.embedFn = fn;
  }

  private client(): EmbedFn {
    if (this.embedFn) return this.embedFn;
    const httpOptions = { timeout: 15_000, retryOptions: { attempts: 2 } };
    let ai: GoogleGenAI;
    if (this.config.get<string>('EMBEDDINGS_USE_VERTEX') === 'true') {
      const project =
        this.config.get<string>('GOOGLE_CLOUD_PROJECT') ||
        this.config.get<string>('BIGQUERY_PROJECT');
      if (!project) {
        throw new Error(
          'Embeddings on Vertex AI need GOOGLE_CLOUD_PROJECT (EMBEDDINGS_USE_VERTEX=true)',
        );
      }
      ai = new GoogleGenAI({
        httpOptions,
        vertexai: true,
        project,
        location:
          this.config.get<string>('EMBEDDINGS_LOCATION') || 'us-central1',
      });
    } else {
      const apiKey = this.config.get<string>('GEMINI_API_KEY');
      if (!apiKey) {
        throw new Error(
          'Embeddings need GEMINI_API_KEY (AI Studio) or EMBEDDINGS_USE_VERTEX=true',
        );
      }
      ai = new GoogleGenAI({ apiKey, httpOptions });
    }
    this.embedFn = async (text, task, dims, model) => {
      const res = await ai.models.embedContent({
        model,
        contents: text,
        config: { taskType: task, outputDimensionality: dims },
      });
      return res.embeddings?.[0]?.values;
    };
    return this.embedFn;
  }

  async embed(text: string, task: EmbedTask): Promise<number[]> {
    const clean = text.trim().slice(0, MAX_EMBED_CHARS);
    if (!clean) throw new Error('nothing to embed');
    const values = await this.client()(clean, task, this.dims, this.model);
    return assertVector(values, this.dims);
  }
}
