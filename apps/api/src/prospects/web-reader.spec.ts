import { randomBytes } from 'crypto';
import * as http from 'http';
import type { AddressInfo } from 'net';
import * as zlib from 'zlib';
import { checkUrl, FetchBlockedError, fetchPage, getOnce } from './web-reader';

describe('web-reader URL vetting', () => {
  it.each([
    // IPv4-mapped IPv6: WHATWG URL rewrites the dotted form to hex, which
    // the old text match missed, so these reached 127.0.0.1 / metadata.
    'http://[::ffff:127.0.0.1]/',
    'http://[::ffff:7f00:1]/',
    'http://[::ffff:a9fe:a9fe]/',
    'http://[::ffff:10.8.0.5]/',
    'http://[0:0:0:0:0:ffff:7f00:1]/',
    'http://[64:ff9b::a9fe:a9fe]/', // NAT64
    'http://[::7f00:1]/', // IPv4-compatible
    'http://[::1]/',
    'http://2130706433/', // 127.0.0.1
    'http://169.254.169.254/',
    // Public literals too: company sites never live on a bare IP.
    'http://8.8.8.8/',
    'https://[2607:f8b0:4005:80a::200e]/',
  ])('refuses %s', (url) => {
    expect(() => checkUrl(url)).toThrow(FetchBlockedError);
  });

  it('refuses a redirect-style hop to a mapped literal via fetchPage', async () => {
    await expect(fetchPage('http://[::ffff:a9fe:a9fe]/')).rejects.toThrow(
      FetchBlockedError,
    );
  });

  it('accepts ordinary company URLs', () => {
    expect(checkUrl('https://acme.com/about').hostname).toBe('acme.com');
    expect(checkUrl('http://www.acme.com:443/').hostname).toBe('www.acme.com');
  });

  it('keeps the port, scheme and credential rules', () => {
    expect(() => checkUrl('http://acme.com:6379/')).toThrow(/ports/);
    expect(() => checkUrl('ftp://acme.com/')).toThrow(/http/);
    expect(() => checkUrl('https://u:p@acme.com/')).toThrow(/credentials/);
  });
});

describe('web-reader getOnce never hangs', () => {
  let server: http.Server;
  let base: string;
  const html = `<html><body>${'Hello world. '.repeat(500)}</body></html>`;

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      if (req.url === '/gzip-ok') {
        res.writeHead(200, {
          'content-type': 'text/html',
          'content-encoding': 'gzip',
        });
        return res.end(zlib.gzipSync(html));
      }
      if (req.url === '/gzip-cut') {
        // Headers + part of a gzip body, then the connection drops.
        // Random hex so the gzip stays large (repetitive text would compress
        // below the 1 KB we send and never actually be cut off).
        const gz = zlib.gzipSync(randomBytes(50_000).toString('hex'));
        res.writeHead(200, {
          'content-type': 'text/html',
          'content-encoding': 'gzip',
          'content-length': String(gz.length),
        });
        res.write(gz.subarray(0, 1024));
        return setTimeout(() => res.socket?.destroy(), 50);
      }
      if (req.url === '/plain-cut') {
        res.writeHead(200, {
          'content-type': 'text/html',
          'content-length': '100000',
        });
        res.write('<html>partial');
        return setTimeout(() => res.socket?.destroy(), 50);
      }
      if (req.url === '/drip') {
        // A byte every 100ms: never idle long enough for the socket timeout.
        res.writeHead(200, { 'content-type': 'text/html' });
        const t = setInterval(() => res.write('x'), 100);
        return res.on('close', () => clearInterval(t));
      }
      res.writeHead(404).end();
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    server.closeAllConnections();
    await new Promise((r) => server.close(r));
  });

  it('reads a complete gzip page', async () => {
    const r = await getOnce(new URL(`${base}/gzip-ok`), 5_000);
    expect(r.status).toBe(200);
    expect(r.body).toBe(html);
  });

  it('rejects (not hangs) when a gzip body is cut off mid-stream', async () => {
    // Budget far above the jest timeout: only the close/error handling can
    // settle this in time, not the deadline.
    await expect(
      getOnce(new URL(`${base}/gzip-cut`), 60_000),
    ).rejects.toThrow();
  }, 5_000);

  it('rejects when an uncompressed body is cut off', async () => {
    await expect(
      getOnce(new URL(`${base}/plain-cut`), 60_000),
    ).rejects.toThrow();
  }, 5_000);

  it('enforces a wall-clock deadline on a dripping server', async () => {
    const t0 = Date.now();
    await expect(getOnce(new URL(`${base}/drip`), 500)).rejects.toThrow(
      /timed out/,
    );
    expect(Date.now() - t0).toBeLessThan(3_000);
  }, 5_000);
});
