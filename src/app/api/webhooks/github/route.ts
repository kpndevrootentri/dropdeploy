import { NextRequest, NextResponse } from 'next/server';
import { webhookService } from '@/services/webhook';
import { deploymentService } from '@/services/deployment';
import { auditLogRepository } from '@/repositories/audit-log.repository';
import { checkWebhookRateLimit, getClientIp } from '@/lib/rate-limit';
import { verifySignature, parsePushRef, parsePushRepoFullName } from '@/lib/github-webhook';
import { createLogger } from '@/lib/logger';
import { getRedisConnection } from '@/lib/redis';

const log = createLogger('webhook-github');

/**
 * Largest delivery accepted. GitHub push payloads are normally tens of KB
 * (they carry at most 20 commits); this leaves ample room while stopping an
 * unauthenticated caller from making us buffer and HMAC arbitrarily large bodies.
 */
const MAX_BODY_BYTES = 5 * 1024 * 1024;

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

  const declaredLength = Number(req.headers.get('content-length') ?? 0);
  if (declaredLength > MAX_BODY_BYTES) {
    return NextResponse.json({ success: false, error: { code: 'PAYLOAD_TOO_LARGE', message: 'Payload too large' } }, { status: 413 });
  }

  // Raw body is required to verify the HMAC — cannot use req.json().
  const raw = await req.text();
  if (Buffer.byteLength(raw) > MAX_BODY_BYTES) {
    return NextResponse.json({ success: false, error: { code: 'PAYLOAD_TOO_LARGE', message: 'Payload too large' } }, { status: 413 });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    return NextResponse.json({ success: false, error: { code: 'INVALID_PAYLOAD', message: 'Invalid JSON' } }, { status: 400 });
  }

  const repoFullName = parsePushRepoFullName(payload as never);
  const branch = parsePushRef(payload as never);
  if (!repoFullName || !branch) {
    // Tag push, branch delete, or malformed payload — nothing to deploy.
    return new NextResponse(null, { status: 204 });
  }

  const signature = req.headers.get('x-hub-signature-256');

  // Find every auto-deploy project matching this repo+branch and verify each
  // against its own secret. Verification is per-project because secrets differ.
  const projects = await webhookService.findProjectsForPush(repoFullName, branch);
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
  // unique ID (redeliveries from its UI get a new one); accept each ID once.
  // Checked only after the signature, so unsigned requests cannot burn IDs.
  const deliveryId = req.headers.get('x-github-delivery');
  if (deliveryId) {
    const firstSeen = await getRedisConnection()
      .set(`webhook:delivery:${deliveryId}`, '1', 'EX', DELIVERY_TTL_S, 'NX')
      .catch(() => 'OK'); // Redis down: fail open rather than drop real pushes
    if (firstSeen === null) {
      log.info('Ignoring replayed webhook delivery', { deliveryId });
      return new NextResponse(null, { status: 204 });
    }
  }

  let triggered = 0;
  for (const project of verified) {
    try {
      const { deployment } = await deploymentService.createDeploymentFromWebhook(project.id);
      triggered++;
      auditLogRepository.create({
        action: 'DEPLOY_TRIGGERED_WEBHOOK',
        targetKey: deployment.id,
        userId: project.userId,
        projectId: project.id,
      }).catch(() => {});
    } catch (err) {
      // Don't fail the whole delivery if one project's enqueue errors.
      log.warn('Webhook deployment trigger failed', { projectId: project.id, error: String(err) });
    }
  }

  return NextResponse.json({ success: true, data: { triggered } }, { status: 202 });
}
