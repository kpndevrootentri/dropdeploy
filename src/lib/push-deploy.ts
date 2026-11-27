import { NextResponse, type NextRequest } from 'next/server';
import { deploymentService } from '@/services/deployment';
import { auditLogRepository } from '@/repositories/audit-log.repository';
import { checkWebhookDeployRateLimit, checkWebhookOwnerDeployRateLimit } from '@/lib/rate-limit';
import { createLogger } from '@/lib/logger';

const log = createLogger('push-deploy');

/**
 * Largest delivery accepted. Push payloads are normally tens of KB (they carry at most 20 commits);
 * this leaves ample room while stopping an unauthenticated caller from making us buffer arbitrarily large bodies.
 */
const MAX_BODY_BYTES = 5 * 1024 * 1024;

/**
 * Reads a push webhook delivery: the raw body (GitHub signs it) and its JSON,
 * or the 413/400 response to send back.
 */
export async function readWebhookJson(req: NextRequest): Promise<{ raw: string; payload: unknown } | NextResponse> {
  const tooLarge = (): NextResponse =>
    NextResponse.json({ success: false, error: { code: 'PAYLOAD_TOO_LARGE', message: 'Payload too large' } }, { status: 413 });
  if (Number(req.headers.get('content-length') ?? 0) > MAX_BODY_BYTES) return tooLarge();
  const raw = await req.text();
  if (Buffer.byteLength(raw) > MAX_BODY_BYTES) return tooLarge();
  try {
    return { raw, payload: JSON.parse(raw) };
  } catch {
    return NextResponse.json({ success: false, error: { code: 'INVALID_PAYLOAD', message: 'Invalid JSON' } }, { status: 400 });
  }
}

/**
 * Queues a deployment for every project a verified push webhook matched (GitHub or GitLab),
 * within the shared per-project and per-owner push limits. `refused` is a limit response,
 * for the caller to return when every project was refused.
 */
export async function deployPushedProjects(
  projects: Array<{ id: string; userId: string; user: { role: string } }>,
): Promise<{ triggered: number; refused: NextResponse | null }> {
  let triggered = 0;
  let refused: NextResponse | null = null;
  for (const project of projects) {
    // Counted only after the caller verified the delivery. The project limit goes first,
    // so a push its project refuses doesn't use up the owner's budget.
    const limited = checkWebhookDeployRateLimit(project.id)
      ?? checkWebhookOwnerDeployRateLimit({ userId: project.userId, role: project.user.role });
    if (limited) {
      refused = limited;
      log.warn('Webhook deployment rate limited', { projectId: project.id, userId: project.userId });
      continue;
    }
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
  return { triggered, refused };
}
