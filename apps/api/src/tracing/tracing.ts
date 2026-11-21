import { TraceExporter } from '@google-cloud/opentelemetry-cloud-trace-exporter';
import { ExpressInstrumentation } from '@opentelemetry/instrumentation-express';
import { HttpInstrumentation } from '@opentelemetry/instrumentation-http';
import { PgInstrumentation } from '@opentelemetry/instrumentation-pg';
import { NodeSDK } from '@opentelemetry/sdk-node';
import { ParentBasedSampler } from '@opentelemetry/sdk-trace-base';
import { RouteSampler } from './route-sampler';

/** Share of ordinary requests traced when TRACING=on (10%, the T13 default). */
export const DEFAULT_SAMPLE_RATE = 0.1;

/**
 * Cloud Trace for the API (Learning Loop T13). Off unless TRACING=on, so tests
 * and local runs are untouched. When on it needs the runtime service account to
 * have roles/cloudtrace.agent (Application Default Credentials on Cloud Run).
 *
 * A child span follows its parent's sampling decision (so one trace is whole,
 * API -> agent -> model); a root span is sampled by RouteSampler.
 */
export function startTracing(env = process.env): NodeSDK | null {
  if (env.TRACING !== 'on') return null;
  const parsed = Number(env.TRACING_SAMPLE_RATE);
  const rate =
    Number.isFinite(parsed) && parsed >= 0 && parsed <= 1
      ? parsed
      : DEFAULT_SAMPLE_RATE;
  const sdk = new NodeSDK({
    serviceName: 'expelly-api',
    traceExporter: new TraceExporter({
      projectId: env.GOOGLE_CLOUD_PROJECT || undefined,
    }),
    sampler: new ParentBasedSampler({ root: new RouteSampler(rate) }),
    instrumentations: [
      new HttpInstrumentation(),
      new ExpressInstrumentation(),
      new PgInstrumentation(),
    ],
  });
  sdk.start();
  // flush what is buffered when Cloud Run stops the container
  process.once('SIGTERM', () => void sdk.shutdown());
  return sdk;
}
