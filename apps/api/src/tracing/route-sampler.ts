import type { Attributes, Context, SpanKind } from '@opentelemetry/api';
import {
  type Sampler,
  SamplingDecision,
  type SamplingResult,
  TraceIdRatioBasedSampler,
} from '@opentelemetry/sdk-trace-base';

/**
 * Which requests are always traced (T13): the scheduled jobs, Review, and
 * Discover. Everything else is sampled (10% in production), so Cloud Trace
 * stays inside its free tier while the routes we debug most are never missed.
 */
const ALWAYS =
  /^\/(internal(\/|$)|reviews?(\/|$)|review-actions(\/|$)|prospects(\/|$)|search-preferences(\/|$)|insights(\/|$)|experiments(\/|$)|campaigns\/[^/]+\/review)/;

export const isAlwaysTraced = (path: string): boolean =>
  ALWAYS.test(path.split('?')[0]);

/** Sampler for ROOT spans: always for the routes above, else a fixed share. */
export class RouteSampler implements Sampler {
  private readonly ratio: TraceIdRatioBasedSampler;

  constructor(rate: number) {
    this.ratio = new TraceIdRatioBasedSampler(rate);
  }

  shouldSample(
    context: Context,
    traceId: string,
    spanName: string,
    spanKind: SpanKind,
    attributes: Attributes,
  ): SamplingResult {
    const raw =
      attributes['url.path'] ??
      attributes['http.target'] ??
      attributes['http.route'] ??
      '';
    if (typeof raw === 'string' && raw && isAlwaysTraced(raw)) {
      return { decision: SamplingDecision.RECORD_AND_SAMPLED };
    }
    // our own named spans (weekly_review, expire_preferences, loop_health)
    if (/^(weekly_review|expire_preferences|loop_health)$/.test(spanName)) {
      return { decision: SamplingDecision.RECORD_AND_SAMPLED };
    }
    return this.ratio.shouldSample(context, traceId);
  }

  toString(): string {
    return `RouteSampler{${this.ratio.toString()}}`;
  }
}
