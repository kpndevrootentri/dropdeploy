import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

/**
 * Hop-by-hop headers that must not be forwarded between proxies per RFC 7230.
 */
const HOP_BY_HOP = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailers',
  'transfer-encoding',
  'upgrade',
]);

/**
 * Headers to strip from the upstream response.
 * Node.js fetch automatically decompresses gzip/br/deflate responses, so
 * forwarding content-encoding would tell the browser to decompress an already
 * decompressed body — causing a "Content Encoding Error". content-length is
 * also stale after decompression and must be dropped.
 */
const STRIP_RESPONSE = new Set(['content-encoding', 'content-length']);

/**
 * In-app reverse proxy for deployed containers.
 *
 * Reached via the middleware rewrite:
 *   {slug}.domain.in/some/path  →  /api/proxy/{slug}/some/path
 *
 * Flow:
 *  1. Look up the active (DEPLOYED) deployment for the slug.
 *  2. Forward the HTTP request to http://127.0.0.1:{containerPort}/{path}.
 *  3. Stream the upstream response back to the client.
 *
 * No nginx config file is written or reloaded on deployment — routing is
 * resolved dynamically from the database on each request.
 */
async function handler(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string; path?: string[] }> }
): Promise<NextResponse> {
  const { slug, path = [] } = await params;

  // Resolve active deployment port from DB
  const deployment = await prisma.deployment.findFirst({
    where: { subdomain: slug, status: 'DEPLOYED' },
    select: { containerPort: true },
  });

  if (!deployment?.containerPort) {
    return NextResponse.json(
      { error: `No active deployment found for "${slug}"` },
      { status: 404 }
    );
  }

  const targetPath = path.length > 0 ? `/${path.join('/')}` : '/';
  const targetUrl = `http://127.0.0.1:${deployment.containerPort}${targetPath}${request.nextUrl.search}`;

  // Build forwarded headers — strip hop-by-hop, host, and accept-encoding.
  // Dropping accept-encoding prevents the container from sending a compressed
  // response; Node.js fetch would decompress it but the stale content-encoding
  // header would cause a browser "Content Encoding Error".
  const forwardHeaders = new Headers();
  for (const [key, value] of request.headers.entries()) {
    const k = key.toLowerCase();
    if (!HOP_BY_HOP.has(k) && k !== 'host' && k !== 'accept-encoding') {
      forwardHeaders.set(key, value);
    }
  }
  forwardHeaders.set('x-forwarded-host', request.headers.get('host') ?? '');
  forwardHeaders.set('x-forwarded-proto', request.nextUrl.protocol.replace(':', ''));

  const hasBody = !['GET', 'HEAD'].includes(request.method);

  let upstream: Response;
  try {
    upstream = await fetch(targetUrl, {
      method: request.method,
      headers: forwardHeaders,
      body: hasBody ? request.body : undefined,
      // duplex is required by Node.js fetch when body is a ReadableStream
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ...(hasBody && ({ duplex: 'half' } as any)),
    });
  } catch {
    return NextResponse.json(
      { error: 'Failed to reach the deployed app. It may still be starting up.' },
      { status: 502 }
    );
  }

  // Forward response headers, filtering hop-by-hop and decompression artifacts
  const responseHeaders = new Headers();
  for (const [key, value] of upstream.headers.entries()) {
    const k = key.toLowerCase();
    if (!HOP_BY_HOP.has(k) && !STRIP_RESPONSE.has(k)) {
      responseHeaders.set(key, value);
    }
  }

  return new NextResponse(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: responseHeaders,
  });
}

export const GET = handler;
export const POST = handler;
export const PUT = handler;
export const PATCH = handler;
export const DELETE = handler;
export const HEAD = handler;
export const OPTIONS = handler;
