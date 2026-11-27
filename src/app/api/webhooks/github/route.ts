import { NextRequest, NextResponse } from 'next/server';
import { webhookService } from '@/services/webhook';
import { checkWebhookRateLimit, getClientIp } from '@/lib/rate-limit';
import { verifySignature, parsePushRef, parsePushRepoFullName } from '@/lib/github-webhook';
import { deployPushedProjects, readWebhookJson } from '@/lib/push-deploy';
import { createLogger } from '@/lib/logger';
import { getRedisConnection } from '@/lib/redis';

const log = createLogger('webhook-github');

/** How long a delivery ID is remembered for replay detection. */
const DELIVERY_TTL_S = 24 * 60 * 60;

/**
 * POST /api/webhooks/github — public GitHub push webhook ingress.
 *
 * This endpoint is unauthenticated; security rests entirely on the per-project
 * HMAC signature (X-Hub-Signature-256) verified against the raw body. It responds
 * fast (202/204) and never builds inline — all work goes through the existing
 * deployment queue — to stay within GitHub's 10s delivery timeout.
 */
export async function POST(req: NextRequest): Promise<NextResponse<unknown>> {
  // Rate-limit by source IP to blunt abuse of the public endpoint.
  const limited = checkWebhookRateLimit(getClientIp(req));
  if (limited) return limited;

  // Only handle push events; ack everything else so GitHub doesn't retry.
  const event = req.headers.get('x-github-event');
  if (event !== 'push') {
    return new NextResponse(null, { status: 204 });
  }

  // Raw body is required to verify the HMAC — cannot use req.json().
  const body = await readWebhookJson(req);
  if (body instanceof NextResponse) return body;
  const { raw, payload } = body;

  const repoFullName = parsePushRepoFullName(payload as never);
  const branch = parsePushRef(payload as never);
  if (!repoFullName || !branch) {
    // Tag push, branch delete, or malformed payload — nothing to deploy.
    return new NextResponse(null, { status: 204 });
  }

  const signature = req.headers.get('x-hub-signature-256');

  // Find every auto-deploy project matching this repo+branch and verify each
  // against its own secret. Verification is per-project because secrets differ.
  const projects = await webhookService.findProjectsForPush(repoFullName, branch, 'GITHUB');
  if (projects.length === 0) {
    return new NextResponse(null, { status: 204 });
  }

  const verified = projects.filter((project) => {
    const secret = webhookService.getSecret(project);
    return !!secret && verifySignature(raw, signature, secret);
  });

  if (verified.length === 0) {
    // Signature matched no project's secret — reject as unauthorized.
    return NextResponse.json(
      { success: false, error: { code: 'INVALID_SIGNATURE', message: 'Signature verification failed' } },
      { status: 401 },
    );
  }

  // A signed delivery stays valid forever, so anyone who captures one could
  // replay it to trigger build after build. GitHub gives each delivery a
  // unique ID, and a redelivery from its UI reuses it; accept each ID once.
  // Checked only after the signature, so unsigned requests cannot burn IDs.
  // GitHub always sends the ID, so a push without one is refused.
  const deliveryId = req.headers.get('x-github-delivery');
  if (!deliveryId) {
    return NextResponse.json(
      { success: false, error: { code: 'MISSING_DELIVERY_ID', message: 'Missing X-GitHub-Delivery header' } },
      { status: 400 },
    );
  }
  const deliveryKey = `webhook:delivery:${deliveryId}`;
  const firstSeen = await getRedisConnection()
    .set(deliveryKey, '1', 'EX', DELIVERY_TTL_S, 'NX')
    .catch(() => 'OK'); // Redis down: fail open rather than drop real pushes
  if (firstSeen === null) {
    log.info('Ignoring replayed webhook delivery', { deliveryId });
    return new NextResponse(null, { status: 204 });
  }

  const { triggered, refused } = await deployPushedProjects(verified);

  // Every matching project is over a limit: say so, so the delivery shows as failed in GitHub, and
  // free the delivery ID, so redelivering it from GitHub deploys once the limit resets.
  if (triggered === 0 && refused) {
    await getRedisConnection().del(deliveryKey).catch(() => {});
    return refused;
  }
  return NextResponse.json({ success: true, data: { triggered } }, { status: 202 });
}
