import { ROOT_CONTEXT, SpanKind } from '@opentelemetry/api';
import { SamplingDecision } from '@opentelemetry/sdk-trace-base';
import { currentTraceparent, withSpan } from './spans';
import { isAlwaysTraced, RouteSampler } from './route-sampler';
import { startTracing } from './tracing';

const TRACE_ID = '0af7651916cd43dd8448eb211c80319c';

describe('tracing (T13)', () => {
  it('always traces the scheduled jobs, Review and Discover routes', () => {
    for (const path of [
      '/internal/cron/weekly-review',
      '/review/health',
      '/reviews/abc/actions/x/approve',
      '/review-actions/abc/revert',
      '/campaigns/9f1c/review',
      '/campaigns/9f1c/review/actions',
      '/prospects/runs',
      '/prospects/runs/abc?x=1',
      '/search-preferences/propose',
      '/insights',
      '/experiments/abc/variants/def/resume',
    ]) {
      expect(isAlwaysTraced(path)).toBe(true);
    }
    for (const path of [
      '/leads',
      '/campaigns',
      '/campaigns/9f1c',
      '/inbox',
      '/t/o/abc',
      '/health/ready',
      '/reviewer',
    ]) {
      expect(isAlwaysTraced(path)).toBe(false);
    }
  });

  it('samples a root span by route: always for those routes, a fixed share for the rest', () => {
    const sampler = new RouteSampler(0);
    const ask = (attrs: Record<string, string>, name = 'GET') =>
      sampler.shouldSample(ROOT_CONTEXT, TRACE_ID, name, SpanKind.SERVER, attrs)
        .decision;
    expect(ask({ 'url.path': '/internal/cron/loop-health' })).toBe(
      SamplingDecision.RECORD_AND_SAMPLED,
    );
    expect(ask({ 'http.target': '/review/health' })).toBe(
      SamplingDecision.RECORD_AND_SAMPLED,
    );
    expect(ask({ 'url.path': '/leads' })).toBe(SamplingDecision.NOT_RECORD); // share 0
    expect(ask({}, 'weekly_review')).toBe(SamplingDecision.RECORD_AND_SAMPLED);
    // a share of 1 keeps everything
    const all = new RouteSampler(1);
    expect(
      all.shouldSample(ROOT_CONTEXT, TRACE_ID, 'GET', SpanKind.SERVER, {
        'url.path': '/leads',
      }).decision,
    ).toBe(SamplingDecision.RECORD_AND_SAMPLED);
  });

  it('is off unless TRACING=on, and then spans and trace context are real no-ops', async () => {
    expect(startTracing({ TRACING: 'off' })).toBeNull();
    expect(startTracing({})).toBeNull();
    // no SDK registered here: a span runs the function and passes its result through
    expect(await withSpan('x', () => Promise.resolve(42))).toBe(42);
    await expect(
      withSpan('x', () => Promise.reject(new Error('boom'))),
    ).rejects.toThrow('boom');
    // nothing to send to an agent: the caller falls back to its own random id
    expect(currentTraceparent()).toBeNull();
  });
});
