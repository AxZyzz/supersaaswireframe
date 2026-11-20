import { lookup as dnsLookup, promises as dns } from 'dns';
import * as http from 'http';
import * as https from 'https';
import { isIP, type LookupFunction } from 'net';
import type { Readable } from 'stream';
import * as zlib from 'zlib';
import { isInternalAddress } from '../senders/smtp-guard';

/**
 * Reads public company websites for prospect research, safely and politely.
 *
 * Safety (SSRF): only http(s) on ports 80/443; every hostname is resolved by
 * our own lookup, which refuses private, loopback, link-local (cloud metadata)
 * and other internal addresses, and the socket connects to exactly the vetted
 * address, so a DNS answer can't pass the check and then point inward. Each
 * redirect hop is re-checked. IP-literal hosts are refused outright. Bodies
 * are capped, and each fetch (redirects included) has a hard wall-clock
 * deadline so a slow or half-closed site can't pin a worker; only HTML/text
 * is read.
 *
 * Politeness: an honest User-Agent, robots.txt respected (Disallow rules for
 * "*" or our agent), a few pages per site.
 */

export const USER_AGENT =
  'ExpellyBot/1.0 (prospect research; contact via the Expelly app)';
const MAX_BYTES = 1_500_000;
const TIMEOUT_MS = 9_000; // socket idle timeout
// Hard cap on one fetchPage, all redirect hops and the body included. The idle
// timeout alone lets a server dripping a byte every few seconds hold a fetch
// (and with it a shared queue worker) open for hours.
const DEADLINE_MS = 15_000;
const MAX_REDIRECTS = 3;

export class FetchBlockedError extends Error {}

/** DNS lookup that refuses internal addresses (all answers must be public). */
export const guardedLookup: LookupFunction = (hostname, options, callback) => {
  dnsLookup(hostname, { all: true }, (err, addresses) => {
    if (err) return callback(err, '', 4);
    const list = addresses;
    if (!list.length || list.some((a) => isInternalAddress(a.address))) {
      return callback(
        new FetchBlockedError(`${hostname} resolves to an internal address`),
        '',
        4,
      );
    }
    if ((options as { all?: boolean }).all) {
      return callback(null, list);
    }
    callback(null, list[0].address, list[0].family);
  });
};

export interface FetchedPage {
  url: string; // final URL after redirects
  status: number;
  html: string;
}

/** Exported for tests. */
export function checkUrl(raw: string): URL {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new FetchBlockedError(`not a URL: ${raw.slice(0, 80)}`);
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    throw new FetchBlockedError('only http(s) URLs are read');
  }
  if (u.port && u.port !== '80' && u.port !== '443') {
    throw new FetchBlockedError('only ports 80/443 are read');
  }
  if (u.username || u.password) {
    throw new FetchBlockedError('URLs with credentials are not read');
  }
  // Node skips the DNS lookup (and so guardedLookup) for IP literals, so
  // they'd never be vetted at connect time. Company websites don't live on
  // bare IPs, so refuse every literal rather than rely on classifying all of
  // its spellings (URL parsing turns "http://2130706433/" into 127.0.0.1 and
  // "[::ffff:127.0.0.1]" into "[::ffff:7f00:1]", for instance).
  const host = u.hostname.replace(/^\[|\]$/g, '');
  if (isIP(host)) {
    throw new FetchBlockedError(
      isInternalAddress(host)
        ? `${host} is an internal address`
        : 'IP-address URLs are not read',
    );
  }
  return u;
}

interface RawResponse {
  status: number;
  location?: string;
  type: string;
  body: string;
}

/**
 * One GET, no redirect following. Settles exactly once: on the body's end, the
 * size cap, any error on the request, response or decoder, the response
 * closing before it's complete, or `budgetMs` of wall-clock time. Exported for
 * tests (it does no URL vetting of its own; use fetchPage).
 */
export function getOnce(u: URL, budgetMs: number): Promise<RawResponse> {
  const mod = u.protocol === 'https:' ? https : http;
  return new Promise((resolve, reject) => {
    // `done` is only ever called asynchronously (events, timer), by which
    // point `req` and `timer` below are initialised.
    let settled = false;
    let stream: Readable | undefined;
    const done = (err: Error | null, value?: RawResponse) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (err || !value) {
        stream?.destroy();
        req.destroy();
        reject(err ?? new Error('no response'));
      } else {
        resolve(value);
      }
    };
    const req = mod.request(
      u,
      {
        method: 'GET',
        lookup: guardedLookup,
        timeout: TIMEOUT_MS,
        headers: {
          'User-Agent': USER_AGENT,
          Accept: 'text/html,application/xhtml+xml,text/plain;q=0.8',
          'Accept-Encoding': 'gzip, deflate, br',
          'Accept-Language': 'en',
        },
      },
      (res) => {
        const status = res.statusCode ?? 0;
        const location = res.headers.location;
        const type = String(res.headers['content-type'] ?? '');
        // pipe() doesn't forward source errors to the decoder, and a response
        // cut off mid-body only emits 'error' if someone listens, so without
        // these a dropped connection on a gzip page left the promise pending
        // forever. Listen on the raw response whatever the encoding.
        res.on('error', (e) => done(e));
        res.on('close', () => {
          if (!res.complete) done(new Error('connection closed mid-response'));
        });
        // Redirect and non-page bodies are discarded: settle, then close the
        // socket so a slow/dripping server can't keep it streaming after we
        // stopped listening (the deadline timer is already cleared).
        if (status >= 300 && status < 400) {
          done(null, { status, location, type, body: '' });
          return res.destroy();
        }
        if (!/text\/html|application\/xhtml|text\/plain/i.test(type)) {
          done(null, { status, type, body: '' });
          return res.destroy();
        }
        const enc = String(res.headers['content-encoding'] ?? '');
        const decoder =
          enc === 'gzip'
            ? zlib.createGunzip()
            : enc === 'deflate'
              ? zlib.createInflate()
              : enc === 'br'
                ? zlib.createBrotliDecompress()
                : null;
        const body: Readable = decoder ? res.pipe(decoder) : res;
        stream = body;
        const chunks: Buffer[] = [];
        let size = 0;
        body.on('data', (c: Buffer) => {
          if (settled) return;
          size += c.length;
          if (size > MAX_BYTES) {
            const text = Buffer.concat(chunks).toString('utf8');
            done(null, { status, type, body: text });
            body.destroy();
            req.destroy();
            return;
          }
          chunks.push(c);
        });
        body.on('end', () =>
          done(null, {
            status,
            type,
            body: Buffer.concat(chunks).toString('utf8'),
          }),
        );
        body.on('error', (e) => done(e));
      },
    );
    // Hard wall-clock deadline: the socket `timeout` above is only an idle
    // timeout, so a server dripping bytes would otherwise never trip it.
    const timer = setTimeout(
      () => done(new Error('timed out')),
      Math.max(0, budgetMs),
    );
    req.on('timeout', () => req.destroy(new Error('timed out')));
    req.on('error', (e) => done(e));
    req.end();
  });
}

/** GET with re-checked redirects. Throws on blocked/unreachable. */
export async function fetchPage(raw: string): Promise<FetchedPage> {
  const deadline = Date.now() + DEADLINE_MS;
  let u = checkUrl(raw);
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const left = deadline - Date.now();
    if (left <= 0) throw new Error('timed out');
    const r = await getOnce(u, left);
    if (r.status >= 300 && r.status < 400 && r.location) {
      u = checkUrl(new URL(r.location, u).toString());
      continue;
    }
    return { url: u.toString(), status: r.status, html: r.body };
  }
  throw new Error('too many redirects');
}

// ── robots.txt ─────────────────────────────────────────────────────────────

/** Disallowed path prefixes that apply to us ("*" or ExpellyBot groups). */
export function parseRobots(txt: string): string[] {
  const rules: string[] = [];
  let applies = false;
  let inAgents = false;
  for (const line of txt.split(/\r?\n/)) {
    const clean = line.replace(/#.*/, '').trim();
    if (!clean) continue;
    const m = /^([a-z-]+)\s*:\s*(.*)$/i.exec(clean);
    if (!m) continue;
    const key = m[1].toLowerCase();
    const value = m[2].trim();
    if (key === 'user-agent') {
      const agent = value.toLowerCase();
      const match = agent === '*' || agent.includes('expellybot');
      applies = inAgents ? applies || match : match;
      inAgents = true;
    } else {
      inAgents = false;
      if (applies && key === 'disallow' && value) rules.push(value);
    }
  }
  return rules;
}

/** robots.txt matching: prefix match, "*" = any characters, "$" = end. */
export function robotsAllows(rules: string[], path: string): boolean {
  return !rules.some((r) => {
    const anchored = r.endsWith('$');
    const body = anchored ? r.slice(0, -1) : r;
    const pattern = body
      .split('*')
      .map((s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
      .join('.*');
    return new RegExp(`^${pattern}${anchored ? '$' : ''}`).test(path);
  });
}

// ── HTML helpers (no DOM library; enough for public marketing pages) ────────

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  '#39': "'",
};

export function decodeEntities(s: string): string {
  return s.replace(/&(#\d+|#x[0-9a-f]+|[a-z]+\d*);/gi, (m, e: string) => {
    const k = e.toLowerCase();
    if (k in ENTITIES) return ENTITIES[k];
    if (k.startsWith('#x'))
      return String.fromCodePoint(parseInt(k.slice(2), 16));
    if (k.startsWith('#'))
      return String.fromCodePoint(parseInt(k.slice(1), 10));
    return m;
  });
}

/** Visible text: scripts, styles, svg and tags dropped, whitespace collapsed. */
export function htmlToText(html: string): string {
  return decodeEntities(
    html
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(
        /<(script|style|noscript|svg|template|iframe)\b[\s\S]*?<\/\1>/gi,
        ' ',
      )
      .replace(/<br\s*\/?>|<\/(p|div|li|h[1-6]|section|tr)>/gi, '\n')
      .replace(/<[^>]+>/g, ' '),
  )
    .replace(/[ \t\f\v\u00a0]+/g, ' ')
    .replace(/\s*\n\s*/g, '\n')
    .trim();
}

export function pageTitle(html: string): string {
  const m = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  return m
    ? decodeEntities(m[1]).replace(/\s+/g, ' ').trim().slice(0, 200)
    : '';
}

export function metaDescription(html: string): string {
  const m =
    /<meta[^>]+name=["']description["'][^>]*content=["']([^"']*)["']/i.exec(
      html,
    ) ??
    /<meta[^>]+property=["']og:description["'][^>]*content=["']([^"']*)["']/i.exec(
      html,
    );
  return m ? decodeEntities(m[1]).trim().slice(0, 400) : '';
}

/** Same-site links whose URL or text suggests contact/about/team pages. */
export function subpageLinks(html: string, base: string, max = 3): string[] {
  const host = new URL(base).hostname.replace(/^www\./, '');
  const scored: { url: string; score: number }[] = [];
  const re = /<a\b[^>]*href=["']([^"'#]+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    let url: URL;
    try {
      url = new URL(decodeEntities(m[1]), base);
    } catch {
      continue;
    }
    if (!/^https?:$/.test(url.protocol)) continue;
    if (url.hostname.replace(/^www\./, '') !== host) continue;
    url.hash = '';
    const hay =
      `${url.pathname} ${m[2].replace(/<[^>]+>/g, ' ')}`.toLowerCase();
    // Contact and legal-notice pages (EU "Impressum"/imprint is required to
    // show a real company email) are where public addresses live.
    const score = /contact|kontakt/.test(hay)
      ? 4
      : /impressum|imprint|legal-notice|legal/.test(hay)
        ? 3
        : /about|company|who-we-are/.test(hay)
          ? 2
          : /privacy|team|leadership|careers/.test(hay)
            ? 1
            : 0;
    if (score && !scored.some((s) => s.url === url.toString())) {
      scored.push({ url: url.toString(), score });
    }
  }
  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, max)
    .map((s) => s.url);
}

const EMAIL_RE =
  /[a-z0-9][a-z0-9._%+-]{0,63}@[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,24}/gi;
const NOT_A_CONTACT =
  /\.(png|jpe?g|gif|svg|webp|css|js)$|@(example|sentry|sentry-next|wixpress|domain|email|yourdomain|yourcompany|company|mysite|website)\.|^(you|your|name|user|someone|john\.?doe|jane\.?doe|firstname|first\.last)@/i;

// FREE_MAIL (free mailboxes small local businesses publish) lives in
// ../leads/company-key so the company key and Discover share one list.

/**
 * Email addresses that literally appear on the page (text or mailto links).
 * Nothing is guessed: no first.last@ permutations. Form placeholders and
 * script-escaped fragments (\u003e…) are cleaned out.
 */
export function extractEmails(html: string): string[] {
  const out = new Set<string>();
  const decoded = decodeEntities(html)
    .replace(/\\u00([0-9a-f]{2})/gi, (_m, h: string) =>
      String.fromCharCode(parseInt(h, 16)),
    )
    .replace(/\\\//g, '/')
    .replace(/%40/gi, '@')
    .replace(/placeholder=["'][^"']*["']/gi, ' ');
  for (const m of decoded.match(EMAIL_RE) ?? []) {
    const e = m.toLowerCase().replace(/\.+$/, '');
    if (!NOT_A_CONTACT.test(e)) out.add(e);
  }
  return [...out].slice(0, 20);
}

const mxCache = new Map<string, Promise<boolean>>();
/** Does the domain accept mail (has MX records)? Cached per process. */
export function hasMx(domain: string): Promise<boolean> {
  const d = domain.toLowerCase();
  let p = mxCache.get(d);
  if (!p) {
    p = dns
      .resolveMx(d)
      .then((r) => r.length > 0)
      .catch(() => false);
    mxCache.set(d, p);
  }
  return p;
}

/** "https://www.Acme.com/x" or "acme.com" → "acme.com". */
export function normalizeDomain(raw: string): string | null {
  const s = raw.trim().toLowerCase();
  if (!s) return null;
  try {
    const u = new URL(/^https?:\/\//.test(s) ? s : `https://${s}`);
    const host = u.hostname.replace(/^www\./, '');
    return /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(host) ? host : null;
  } catch {
    return null;
  }
}
