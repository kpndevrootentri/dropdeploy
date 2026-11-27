import { randomBytes } from 'crypto';
import type { Project } from '@prisma/client';
import { projectRepository, type IProjectRepository } from '@/repositories/project.repository';
import { gitProviderService, type IGitProviderService } from '@/services/git-provider';
import { encryptionService, type IEncryptionService } from '@/services/encryption';
import { createGitHubHook, deleteGitHubHook } from '@/lib/providers/github';
import { gitlabPathFromUrl, repoFullNameFromUrl, type GitSource } from '@/lib/git-url';
import { getConfig } from '@/lib/config';
import { createLogger } from '@/lib/logger';
import { NotFoundError, ValidationError } from '@/lib/errors';

const log = createLogger('webhook-service');

const WEBHOOK_PATH = '/api/webhooks/github';
const GITLAB_WEBHOOK_PATH = '/api/webhooks/gitlab';

/** What the student pastes into GitLab's webhook form. The secret is only ever returned here, once. */
export interface GitLabWebhookSetup {
  url: string;
  secret: string;
}

export interface IWebhookService {
  enableAutoDeploy(projectId: string, userId: string): Promise<{ project: Project; gitlabWebhook?: GitLabWebhookSetup }>;
  disableAutoDeploy(projectId: string, userId: string): Promise<Project>;
  findProjectsForPush(repoPath: string, branch: string | null, source: GitSource): Promise<(Project & { user: { role: string } })[]>;
  getSecret(project: Project): string | null;
}

export class WebhookService implements IWebhookService {
  constructor(
    private readonly projectRepo: IProjectRepository,
    private readonly gitProvider: IGitProviderService,
    private readonly encryption: IEncryptionService,
  ) {}

  /**
   * Enable auto-deploy with a fresh secret. GitHub: registers the push webhook via
   * the owner's OAuth token, then persists the hook id + encrypted secret.
   * Idempotent-ish: a pre-existing hook is removed first so we never leak orphaned
   * hooks on re-enable. GitLab: the student adds the hook by hand, so the URL and
   * plaintext secret are returned for them to paste; calling it again rotates the secret.
   */
  async enableAutoDeploy(projectId: string, userId: string): Promise<{ project: Project; gitlabWebhook?: GitLabWebhookSetup }> {
    const project = await this.loadOwned(projectId, userId);

    if (project.source === 'GITLAB' && project.githubUrl) {
      return this.enableGitLabAutoDeploy(project.id, project.githubUrl);
    }
    if (project.source !== 'GITHUB' || !project.githubUrl) {
      throw new ValidationError('Auto-deploy is only available for GitHub and GitLab projects.');
    }

    const token = await this.gitProvider.getTokenForDeployment(userId, 'GITHUB');
    if (!token) {
      throw new ValidationError('Connect your GitHub account before enabling auto-deploy.');
    }

    const fullName = repoFullNameFromUrl(project.githubUrl);

    // Clean up any stale hook before creating a new one (re-enable / secret rotation).
    if (project.githubHookId) {
      await deleteGitHubHook(token, fullName, project.githubHookId).catch((err) => {
        log.warn('Failed to remove stale webhook before re-enable', { projectId, error: String(err) });
      });
    }

    const { APP_URL } = getConfig();
    if (!APP_URL) {
      throw new ValidationError('APP_URL is not configured; cannot register a webhook URL.');
    }

    const secret = randomBytes(32).toString('hex');
    const { id: hookId } = await createGitHubHook(token, fullName, {
      url: `${APP_URL}${WEBHOOK_PATH}`,
      secret,
    });

    const enc = this.encryption.encrypt(secret);
    const updated = await this.projectRepo.setWebhookConfig(projectId, {
      githubHookId: String(hookId),
      webhookSecretEnc: enc.encryptedValue,
      webhookSecretIv: enc.iv,
      webhookSecretTag: enc.authTag,
    });

    log.info('Auto-deploy enabled', { projectId, fullName, hookId });
    return { project: updated };
  }

  private async enableGitLabAutoDeploy(projectId: string, repoUrl: string): Promise<{ project: Project; gitlabWebhook: GitLabWebhookSetup }> {
    const path = gitlabPathFromUrl(repoUrl); // a push can only match a gitlab.com project path

    const { APP_URL } = getConfig();
    if (!APP_URL) {
      throw new ValidationError('APP_URL is not configured; cannot show a webhook URL.');
    }

    const secret = randomBytes(32).toString('hex');
    const enc = this.encryption.encrypt(secret);
    const project = await this.projectRepo.setWebhookConfig(projectId, {
      githubHookId: null,
      webhookSecretEnc: enc.encryptedValue,
      webhookSecretIv: enc.iv,
      webhookSecretTag: enc.authTag,
    });

    log.info('Auto-deploy enabled', { projectId, path });
    return { project, gitlabWebhook: { url: `${APP_URL}${GITLAB_WEBHOOK_PATH}`, secret } };
  }

  /**
   * Disable auto-deploy and remove the GitHub hook. Hook removal is best-effort —
   * the local config is always cleared so the project never appears auto-deploy.
   * GitLab projects have no hook id, so their hook stays in GitLab for the student
   * to delete; its deliveries no longer match and get a 204.
   */
  async disableAutoDeploy(projectId: string, userId: string): Promise<Project> {
    const project = await this.loadOwned(projectId, userId);

    if (project.githubHookId && project.githubUrl) {
      const token = await this.gitProvider.getTokenForDeployment(userId, 'GITHUB');
      if (token) {
        await deleteGitHubHook(token, repoFullNameFromUrl(project.githubUrl), project.githubHookId).catch((err) => {
          log.warn('Failed to delete GitHub webhook on disable', { projectId, error: String(err) });
        });
      }
    }

    const updated = await this.projectRepo.clearWebhookConfig(projectId);
    log.info('Auto-deploy disabled', { projectId });
    return updated;
  }

  /**
   * All auto-deploy projects of `source` whose repo + branch match an incoming push.
   * `repoPath` is GitHub's "owner/repo" or GitLab's "group/subgroup.../project".
   * A single repo+branch can back multiple projects, so this returns every match.
   * A null `branch` matches every branch. Projects with an unparseable githubUrl are skipped defensively.
   */
  async findProjectsForPush(repoPath: string, branch: string | null, source: GitSource): Promise<(Project & { user: { role: string } })[]> {
    const target = repoPath.toLowerCase();
    const pathOf = source === 'GITLAB' ? gitlabPathFromUrl : repoFullNameFromUrl;
    const candidates = await this.projectRepo.findAutoDeployByBranch(branch, source);
    return candidates.filter((p) => {
      if (!p.githubUrl) return false;
      try {
        return pathOf(p.githubUrl) === target;
      } catch {
        return false;
      }
    });
  }

  /** Decrypts a project's stored webhook secret, or null if not configured. */
  getSecret(project: Project): string | null {
    if (!project.webhookSecretEnc || !project.webhookSecretIv || !project.webhookSecretTag) {
      return null;
    }
    return this.encryption.decrypt({
      encryptedValue: project.webhookSecretEnc,
      iv: project.webhookSecretIv,
      authTag: project.webhookSecretTag,
    });
  }

  private async loadOwned(projectId: string, userId: string): Promise<Project> {
    const project = await this.projectRepo.findById(projectId);
    // 404 (not 403) on ownership mismatch — avoids leaking project existence.
    if (!project || project.userId !== userId) {
      throw new NotFoundError('Project');
    }
    return project;
  }
}

export const webhookService = new WebhookService(
  projectRepository,
  gitProviderService,
  encryptionService,
);
