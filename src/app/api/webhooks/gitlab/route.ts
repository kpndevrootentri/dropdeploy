import { NextRequest, NextResponse } from 'next/server';
import { webhookService } from '@/services/webhook';
import { checkWebhookRateLimit, getClientIp } from '@/lib/rate-limit';
import { parseGitLabPush, verifyGitLabToken } from '@/lib/gitlab-webhook';
import { deployPushedProjects, readWebhookJson } from '@/lib/push-deploy';

/**
 * POST /api/webhooks/gitlab — public GitLab push webhook ingress.
 *
 * The student adds this URL and the project's secret to their GitLab project
 * by hand; security rests on the `X-Gitlab-Token` header matching that
 * project's own secret. Like the GitHub route it answers fast (202/204) and
 * only queues builds, which always use the stored repo URL and branch.
 *
 * GitLab counts every non-2xx answer as a failed delivery and disables a hook that keeps
 * failing, so a well-formed delivery with a valid token gets a 2xx (the per-IP limit aside),
 * even when nothing deploys.
 */
export async function POST(req: NextRequest): Promise<NextResponse<unknown>> {
  const limited = checkWebhookRateLimit(getClientIp(req));
  if (limited) return limited;

  // Only push events deploy; ack everything else so GitLab doesn't count it as a failure.
  if (req.headers.get('x-gitlab-event') !== 'Push Hook') {
    return new NextResponse(null, { status: 204 });
  }

  const body = await readWebhookJson(req);
  if (body instanceof NextResponse) return body;

  const push = parseGitLabPush(body.payload as never);
  if (!push) {
    // Tag push, branch delete, or malformed payload — nothing to deploy.
    return new NextResponse(null, { status: 204 });
  }

  // Every branch: the hook is set to all branches, so it also sends pushes meant for another
  // Entrify project on this repo. The token picks the project; a 401 there would get the hook disabled.
  const projects = await webhookService.findProjectsForPush(push.path, null, 'GITLAB');
  if (projects.length === 0) {
    return new NextResponse(null, { status: 204 });
  }

  // Secrets differ per project, so each match is checked against its own.
  const token = req.headers.get('x-gitlab-token');
  const verified = projects.filter((project) => {
    const secret = webhookService.getSecret(project);
    return !!secret && verifyGitLabToken(token, secret);
  });
  if (verified.length === 0) {
    return NextResponse.json(
      { success: false, error: { code: 'INVALID_TOKEN', message: 'Webhook token verification failed' } },
      { status: 401 },
    );
  }
  const onBranch = verified.filter((project) => project.branch === push.branch);
  if (onBranch.length === 0) {
    return new NextResponse(null, { status: 204 });
  }

  // ponytail: no delivery-ID replay check as on GitHub. The token is a static credential, so anyone
  // able to replay a delivery can already send a new one; repeats collapse through the queued-deploy
  // supersede and the push limits. Add one if GitLab hooks move to signed deliveries.
  const { triggered, refused } = await deployPushedProjects(onBranch);

  // Every matching project is over a limit: still a 2xx, or GitLab disables the hook and pushes made
  // after the limit resets never arrive. The message shows in the hook's Recent events.
  if (triggered === 0 && refused) {
    const { error } = await refused.json();
    return NextResponse.json({ success: true, data: { triggered, message: error.message } }, { status: 202 });
  }
  return NextResponse.json({ success: true, data: { triggered } }, { status: 202 });
}
