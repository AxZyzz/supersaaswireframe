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
    const a = ip.toLowerCase();
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(a);
    if (mapped) return isInternalAddress(mapped[1]);
    return (
      a === '::' ||
      a === '::1' ||
      /^f[cd]/.test(a) || // fc00::/7 unique local
      /^fe[89ab]/.test(a) || // fe80::/10 link-local
      /^ff/.test(a) || // multicast
      a.startsWith('64:ff9b:') || // NAT64 (could reach internal v4)
      a.startsWith('2001:db8') // documentation
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
