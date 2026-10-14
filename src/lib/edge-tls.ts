import * as tls from 'tls';

/**
 * Completes one TLS handshake with our own edge for `hostname` (sent as SNI),
 * resolving once the edge presents a certificate valid for that name.
 *
 * Connecting to the edge's own address — never to wherever `hostname`
 * resolves — is the point. The hostname is user-controlled: after verifying it
 * a user can re-point its DNS at 169.254.169.254 or a 10.x service, and a
 * plain `fetch(https://hostname)` from the worker would then reach it. Here the
 * name only ever travels inside the handshake.
 */
export function probeEdgeTls(hostname: string, edgeAddress: string, timeoutMs: number): Promise<void> {
  const sep = edgeAddress.lastIndexOf(':');
  const host = sep === -1 ? edgeAddress : edgeAddress.slice(0, sep);
  const port = sep === -1 ? 443 : Number(edgeAddress.slice(sep + 1));

  return new Promise((resolve, reject) => {
    const socket = tls.connect({ host, port, servername: hostname, timeout: timeoutMs });
    socket.once('secureConnect', () => {
      socket.end();
      resolve();
    });
    socket.once('timeout', () => {
      socket.destroy();
      reject(new Error(`TLS handshake with the edge timed out after ${timeoutMs}ms`));
    });
    socket.once('error', (err) => {
      socket.destroy();
      reject(err);
    });
  });
}
