import { startTracing } from './tracing';

/**
 * Imported FIRST by main.ts: the instrumentation has to be in place before
 * http, express and pg are loaded, or it cannot see them.
 */
export const tracingSdk = startTracing();
