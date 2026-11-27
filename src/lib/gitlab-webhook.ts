/**
 * GitLab webhook helpers: token verification and push-event parsing.
 *
 * GitLab does not sign deliveries. It sends the secret the user pasted into the
 * hook back verbatim in the `X-Gitlab-Token` header, so that header is the only
 * proof a delivery came from the project's own hook.
 */
import { createHash, timingSafeEqual } from 'crypto';
import { parsePushRef } from '@/lib/github-webhook';

const sha256 = (value: string): Buffer => createHash('sha256').update(value, 'utf8').digest();

/**
 * Constant-time check of the `X-Gitlab-Token` header against a project's secret.
 * Both sides are hashed first, so the lengths always match and nothing leaks about the secret's length.
 */
export function verifyGitLabToken(header: string | null, secret: string): boolean {
  if (header === null) return false;
  return timingSafeEqual(sha256(header), sha256(secret));
}

interface GitLabPushPayload {
  object_kind?: unknown;
  ref?: unknown;
  after?: unknown;
  project?: { path_with_namespace?: unknown };
}

/**
 * The lowercased project path and branch of a GitLab branch push, or null when
 * there is nothing to deploy: another event, a tag push, a branch delete or a malformed payload.
 */
export function parseGitLabPush(payload: GitLabPushPayload): { path: string; branch: string } | null {
  if (payload?.object_kind !== 'push') return null;
  const branch = parsePushRef(payload);
  const path = payload.project?.path_with_namespace;
  if (!branch || typeof path !== 'string' || path.length === 0) return null;
  // A deleted branch is a push whose new commit is all zeros (40 for SHA-1 repos, 64 for SHA-256).
  if (typeof payload.after === 'string' && /^0+$/.test(payload.after)) return null;
  return { path: path.toLowerCase(), branch };
}
