import { isSpanContextValid, SpanStatusCode, trace } from '@opentelemetry/api';

/**
 * Tiny helpers over @opentelemetry/api (T13). The API package alone does
 * nothing: with tracing off (the default) every span here is a no-op, so
 * callers never check a flag.
 */
export function withSpan<T>(name: string, fn: () => Promise<T>): Promise<T> {
  return trace.getTracer('expelly-api').startActiveSpan(name, async (span) => {
    try {
      return await fn();
    } catch (e) {
      span.recordException(e as Error);
      span.setStatus({ code: SpanStatusCode.ERROR });
      throw e;
    } finally {
      span.end();
    }
  });
}

/**
 * The W3C `traceparent` of the span running right now, or null when tracing is
 * off. Sent to the agents, so one Cloud Trace shows API -> agent -> model.
 */
export function currentTraceparent(): {
  header: string;
  traceId: string;
} | null {
  const sc = trace.getActiveSpan()?.spanContext();
  if (!sc || !isSpanContextValid(sc)) return null;
  const flags = (sc.traceFlags & 1) === 1 ? '01' : '00';
  return {
    header: `00-${sc.traceId}-${sc.spanId}-${flags}`,
    traceId: sc.traceId,
  };
}
