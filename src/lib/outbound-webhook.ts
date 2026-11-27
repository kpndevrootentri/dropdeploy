/**
 * Outbound HTTPS POSTs to URLs that project owners choose (notification hooks).
 *
 * The deployment worker sends them from the host, so a hook URL must never
 * reach a loopback, private or link-local address. It may only name a public host:
 * - parseHookUrl refuses anything but https on 443, credentials and IP literals
 *   (Node skips `lookup` for those, so the check below would never run);
 * - guardedLookup resolves the name and refuses it if any address is private;
 * - the socket connects to the address guardedLookup approved, so a DNS answer
 *   that changes between the check and the connect cannot get past it;
 * - redirects are never followed and response bodies are never read.
 */
import * as dns from 'dns';
import * as https from 'https';
import * as net from 'net';
import { ValidationError } from '@/lib/errors';

const TIMEOUT_MS = 10_000;

export class BlockedAddressError extends Error {
  constructor(hostname: string) {
    super(`${hostname} does not resolve to a public address`);
    this.name = 'BlockedAddressError';
  }
}

/** A hook URL as it may be stored and posted to. Throws a ValidationError saying why not. */
export function parseHookUrl(input: string): URL {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new ValidationError('Enter a full URL, starting with https://');
  }
  if (url.protocol !== 'https:') throw new ValidationError('The URL must start with https://');
  // The parser drops a default :443, so any port left is another one.
  if (url.port !== '') throw new ValidationError('The URL must use the standard HTTPS port (443)');
  if (url.username || url.password) throw new ValidationError('The URL must not contain a username or password');
  // The parser has already turned decimal and hex forms (2130706433, 0x7f.1) into dotted ones.
  if (net.isIP(url.hostname.replace(/^\[|\]$/g, ''))) {
    throw new ValidationError('Use a hostname, not an IP address');
  }
  return url;
}

const BLOCKED = new net.BlockList();
for (const [address, prefix] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16],
  ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15],
  ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 3],
] as const) {
  BLOCKED.addSubnet(address, prefix, 'ipv4');
}

/**
 * A `lookup` for net/https that only ever answers with public IPv4 addresses.
 * ponytail: IPv4 only. Add the IPv6 private ranges (::1, fc00::/7, fe80::/10, mapped v4) before allowing family 6.
 */
export const guardedLookup: net.LookupFunction = (hostname, options, callback) => {
  dns.lookup(hostname, { family: 4, all: true }, (err, addresses) => {
    if (err) return callback(err, '');
    if (addresses.length === 0 || addresses.some((a) => BLOCKED.check(a.address, 'ipv4'))) {
      return callback(new BlockedAddressError(hostname), '');
    }
    // Node asks for every address when it races them (autoSelectFamily), otherwise for one.
    if (options.all) return callback(null, addresses);
    callback(null, addresses[0].address, 4);
  });
};

/**
 * POSTs `body` and resolves with the response status. Rejects with a
 * BlockedAddressError, an AbortError after 10 s, or the socket's error.
 */
export function postJson(url: URL, body: string, headers: Record<string, string>): Promise<number> {
  return new Promise((resolve, reject) => {
    const req = https.request(
      url,
      {
        method: 'POST',
        headers: { ...headers, 'Content-Length': String(Buffer.byteLength(body)) },
        lookup: guardedLookup,
        agent: false,
        signal: AbortSignal.timeout(TIMEOUT_MS),
      },
      (res) => {
        resolve(res.statusCode ?? 0);
        res.destroy();
      },
    );
    req.on('error', reject);
    req.end(body);
  });
}
