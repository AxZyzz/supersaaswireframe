import { BadRequestException } from '@nestjs/common';
import { promises as dns } from 'dns';
import { isIP } from 'net';

/**
 * SSRF guard for user-supplied SMTP hosts. A sender's host/port are typed in
 * by workspace admins and the API connects to them (verify, test send,
 * campaigns). Unchecked, that lets anyone probe the server's internal network:
 * Redis, Postgres, the cloud metadata service (169.254.169.254), and learn
 * which ports are open from the error text.
 *
 * - Only mail ports are allowed.
 * - Private, loopback, link-local, CGNAT, multicast and reserved addresses are
 *   refused, both as literals and as what a hostname resolves to.
 * - The connection goes to the vetted IP (TLS still checks the hostname), so
 *   a DNS record can't pass the check and then point somewhere internal.
 * SMTP_ALLOW_PRIVATE_HOSTS=on lifts the address rule (self-hosted mail server
 * on a private network, or a local test inbox in development).
 */
export const SMTP_PORTS = [25, 465, 587, 2525] as const;

const allowPrivate = () => process.env.SMTP_ALLOW_PRIVATE_HOSTS === 'on';

function v4ToInt(ip: string): number {
  return ip.split('.').reduce((n, o) => (n << 8) + Number(o), 0) >>> 0;
}

const V4_BLOCKED: [string, number][] = [
  ['0.0.0.0', 8], // "this" network
  ['10.0.0.0', 8], // private
  ['100.64.0.0', 10], // CGNAT
  ['127.0.0.0', 8], // loopback
  ['169.254.0.0', 16], // link-local (cloud metadata)
  ['172.16.0.0', 12], // private
  ['192.0.0.0', 24], // IETF protocol assignments
  ['192.0.2.0', 24], // documentation
  ['192.168.0.0', 16], // private
  ['198.18.0.0', 15], // benchmarking
  ['198.51.100.0', 24], // documentation
  ['203.0.113.0', 24], // documentation
  ['224.0.0.0', 4], // multicast
  ['240.0.0.0', 4], // reserved + broadcast
];

function intToV4(n: number): string {
  return [n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join('.');
}

/**
 * An IPv6 address as its eight 16-bit groups, whatever the textual form
 * ("::ffff:127.0.0.1", "::ffff:7f00:1", "0:0:0:0:0:ffff:7f00:1", a "%zone"
 * suffix…). Matching on the text misses equivalent spellings: WHATWG URL
 * parsing rewrites "[::ffff:127.0.0.1]" to "[::ffff:7f00:1]", for instance.
 * Null if it can't be parsed (callers then treat it as internal).
 */
function v6Groups(ip: string): number[] | null {
  let s = ip.toLowerCase().split('%')[0];
  const dotted = /(\d+\.\d+\.\d+\.\d+)$/.exec(s);
  if (dotted) {
    if (isIP(dotted[1]) !== 4) return null;
    const n = v4ToInt(dotted[1]);
    s = `${s.slice(0, -dotted[1].length)}${(n >>> 16).toString(16)}:${(n & 0xffff).toString(16)}`;
  }
  const halves = s.split('::');
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(':') : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  const fill = halves.length === 2 ? 8 - head.length - tail.length : 0;
  if (fill < 0) return null;
  const groups = [...head, ...Array<string>(fill).fill('0'), ...tail].map(
    (g) => (/^[0-9a-f]{1,4}$/.test(g) ? parseInt(g, 16) : NaN),
  );
  return groups.length === 8 && groups.every((g) => !Number.isNaN(g))
    ? groups
    : null;
}

/** True for any address that isn't a normal public unicast address. */
export function isInternalAddress(ip: string): boolean {
  const kind = isIP(ip);
  if (kind === 4) {
    const n = v4ToInt(ip);
    return V4_BLOCKED.some(([base, bits]) => {
      const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
      return (n & mask) === (v4ToInt(base) & mask);
    });
  }
  if (kind === 6) {
    const g = v6Groups(ip);
    if (!g) return true;
    const embeddedV4 = (hi: number, lo: number) =>
      intToV4(((hi << 16) | lo) >>> 0);
    // ::ffff:0:0/96 IPv4-mapped: the kernel connects to the embedded IPv4
    // address, so judge that address (any spelling, dotted or hex).
    if (g.slice(0, 5).every((x) => x === 0) && g[5] === 0xffff) {
      return isInternalAddress(embeddedV4(g[6], g[7]));
    }
    // Only 2000::/3 is global unicast. Everything else is internal or
    // reserved: ::/8 (unspecified, loopback, IPv4-compatible ::/96, SIIT,
    // NAT64 64:ff9b::/96), fc00::/7 unique local, fe80::/10 link-local,
    // fec0::/10 site-local, ff00::/8 multicast.
    if ((g[0] & 0xe000) !== 0x2000) return true;
    // 6to4 (2002::/16) tunnels to the IPv4 address in groups 1-2.
    if (g[0] === 0x2002) return isInternalAddress(embeddedV4(g[1], g[2]));
    return (
      (g[0] === 0x2001 && g[1] === 0) || // Teredo 2001::/32 (tunnelled v4)
      (g[0] === 0x2001 && g[1] === 0xdb8) || // documentation
      (g[0] === 0x2001 && g[1] === 2 && g[2] === 0) // benchmarking 2001:2::/48
    );
  }
  return true; // not an IP at all: refuse
}

/** Save-time check (no DNS): mail ports only, no internal IP literals. */
export function assertSmtpTarget(host: string, port: number) {
  if (!(SMTP_PORTS as readonly number[]).includes(port)) {
    throw new BadRequestException(
      `SMTP port must be one of ${SMTP_PORTS.join(', ')}.`,
    );
  }
  const h = host.trim().toLowerCase();
  if (!allowPrivate() && (h === 'localhost' || h.endsWith('.localhost'))) {
    throw new BadRequestException('SMTP host must be a public mail server.');
  }
  if (!allowPrivate() && isIP(h) && isInternalAddress(h)) {
    throw new BadRequestException('SMTP host must be a public mail server.');
  }
}

/**
 * Connect-time check: resolves the host and returns the address to connect
 * to. Throws a plain Error (shown as the verify/send failure) if any resolved
 * address is internal.
 */
export async function resolveSmtpHost(
  host: string,
  port: number,
): Promise<string> {
  assertSmtpTarget(host, port);
  if (isIP(host)) return host;
  const addrs = await dns.lookup(host, { all: true, verbatim: true });
  if (!addrs.length) throw new Error(`Could not resolve ${host}`);
  if (!allowPrivate() && addrs.some((a) => isInternalAddress(a.address))) {
    throw new Error(
      'SMTP host resolves to a private network address; refused.',
    );
  }
  return addrs[0].address;
}
