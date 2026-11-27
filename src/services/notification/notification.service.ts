import { createHmac, randomBytes } from 'crypto';
import { UnrecoverableError, type Job } from 'bullmq';
import type { NotificationHook, Project } from '@prisma/client';
import { notificationHookRepository, type INotificationHookRepository } from '@/repositories/notification-hook.repository';
import { deploymentRepository, type IDeploymentRepository } from '@/repositories/deployment.repository';
import { projectRepository, type IProjectRepository } from '@/repositories/project.repository';
import { encryptionService, type IEncryptionService } from '@/services/encryption';
import { notificationQueueAdapter, type INotificationQueue, type NotificationJob } from '@/lib/queue';
import { BlockedAddressError, parseHookUrl, postJson } from '@/lib/outbound-webhook';
import { getDeployedProjectUrl } from '@/lib/project-url';
import { getConfig } from '@/lib/config';
import { NotFoundError, ValidationError } from '@/lib/errors';
import { createLogger } from '@/lib/logger';
import type { CreateNotificationHookDto, NotificationEvent } from '@/validators/notification.validator';

const log = createLogger('notifications');

export const MAX_HOOKS_PER_PROJECT = 3;

export type HookKind = 'slack' | 'discord' | 'generic';

/** What the owner sees of a hook: never its URL or secret. */
export interface NotificationHookView {
  id: string;
  host: string;
  kind: HookKind;
  events: string[];
  lastStatus: string | null;
  lastAttemptAt: Date | null;
  createdAt: Date;
}

type PayloadProject = Pick<Project, 'id' | 'name' | 'slug'>;

/** The JSON a generic hook receives; Slack and Discord get one line made from it. */
export type HookPayload = {
  event: string;
  createdAt: string;
  project: { id: string; name: string; slug: string; url: string };
  deployment?: {
    id: string;
    status: string;
    commitHash: string | null;
    failureReason: string | null;
    completedAt: Date | string | null;
    dashboardUrl: string | null;
  };
};

/** A delivery's result as stored on the hook: coarse on purpose, so the row cannot be used to probe networks. */
type Outcome = number | 'blocked' | 'timeout' | 'unreachable';

export function hookKind(host: string): HookKind {
  if (host === 'hooks.slack.com') return 'slack';
  if (host === 'discord.com' || host === 'discordapp.com') return 'discord';
  return 'generic';
}

/** `sha256=` + hex HMAC-SHA256 of `<timestamp>.<body>` with the hook's secret. */
export function signDelivery(secret: string, timestamp: string, body: string): string {
  return 'sha256=' + createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');
}

export class NotificationService {
  constructor(
    private readonly hooks: INotificationHookRepository,
    private readonly deployments: IDeploymentRepository,
    private readonly projects: IProjectRepository,
    private readonly encryption: IEncryptionService,
    private readonly queue: INotificationQueue,
  ) {}

  async list(projectId: string, userId: string): Promise<NotificationHookView[]> {
    await this.assertOwner(projectId, userId);
    return (await this.hooks.listByProject(projectId)).map(toView);
  }

  /** Adds a hook and queues a ping to it. The secret is returned here only. */
  async create(projectId: string, userId: string, dto: CreateNotificationHookDto): Promise<NotificationHookView & { secret: string }> {
    const project = await this.assertOwner(projectId, userId);
    const url = parseHookUrl(dto.url);
    const secret = randomBytes(32).toString('hex');
    const enc = this.encryption.encrypt(JSON.stringify({ url: url.href, secret }));
    const hook = await this.hooks.create({
      projectId,
      host: url.hostname,
      configEnc: enc.encryptedValue,
      configIv: enc.iv,
      configTag: enc.authTag,
      events: dto.events,
    }, MAX_HOOKS_PER_PROJECT);
    if (!hook) {
      throw new ValidationError(`A project can have up to ${MAX_HOOKS_PER_PROJECT} notification hooks. Delete one to add another.`);
    }
    // The ping's result shows on the hook's row, which is how the owner tests the URL.
    void this.queue.add({ hookId: hook.id, event: 'ping', payload: payloadFor('ping', project) }).catch((err) =>
      log.warn('Could not queue the ping', { hookId: hook.id, error: String(err) }),
    );
    return { ...toView(hook), secret };
  }

  async remove(projectId: string, userId: string, hookId: string): Promise<void> {
    await this.assertOwner(projectId, userId);
    if (!(await this.hooks.delete(hookId, projectId))) throw new NotFoundError('Notification hook');
  }

  /**
   * Queues the deployment's outcome to its project's hooks. Called after the
   * final status is written; never rejects, so a notification problem cannot fail a deploy.
   */
  async deploymentFinished(deploymentId: string): Promise<void> {
    try {
      const deployment = await this.deployments.findByIdWithProject(deploymentId);
      const event: NotificationEvent | null =
        deployment?.status === 'DEPLOYED' ? 'deployment.succeeded' : deployment?.status === 'FAILED' ? 'deployment.failed' : null;
      if (!deployment || !event) return;
      const { APP_URL } = getConfig();
      await this.emit(deployment.project, event, {
        deployment: {
          id: deployment.id,
          status: deployment.status,
          commitHash: deployment.commitHash,
          failureReason: deployment.failureReason,
          completedAt: deployment.completedAt,
          dashboardUrl: APP_URL ? `${APP_URL}/projects/${deployment.project.id}` : null,
        },
      });
    } catch (err) {
      log.warn('Could not queue deployment notifications', { deploymentId, error: String(err) });
    }
  }

  /**
   * Queues `event` to every hook of the project subscribed to it. New events
   * (a later site.down / site.recovered) add their name to NOTIFICATION_EVENTS and call this.
   */
  async emit(project: PayloadProject, event: NotificationEvent, extra: Partial<HookPayload> = {}): Promise<void> {
    const hooks = (await this.hooks.listByProject(project.id)).filter((h) => h.events.includes(event));
    if (hooks.length === 0) return;
    const payload = { ...payloadFor(event, project), ...extra };
    await Promise.all(hooks.map((h) => this.queue.add({ hookId: h.id, event, payload })));
  }

  /** Worker side: one delivery. Throws to have BullMQ retry, or an UnrecoverableError to give up. */
  async deliver(job: Job<NotificationJob>): Promise<void> {
    const hook = await this.hooks.findById(job.data.hookId);
    if (!hook) return; // deleted after it was queued
    const config = JSON.parse(
      this.encryption.decrypt({ encryptedValue: hook.configEnc, iv: hook.configIv, authTag: hook.configTag }),
    ) as { url: string; secret: string };

    const outcome: Outcome = await this.send(hook, config, job).catch(outcomeOf);
    await this.hooks.setLastStatus(hook.id, String(outcome), new Date());
    // The host only: Slack and Discord URLs are credentials.
    log.info('Notification sent', { hookId: hook.id, host: hook.host, event: job.data.event, outcome });

    if (typeof outcome === 'number' && outcome >= 200 && outcome < 300) return;
    const retry = outcome === 'timeout' || outcome === 'unreachable' || outcome === 429 || (typeof outcome === 'number' && outcome >= 500);
    const message = `Delivery to ${hook.host} failed: ${outcome}`;
    throw retry ? new Error(message) : new UnrecoverableError(message);
  }

  private async send(hook: NotificationHook, config: { url: string; secret: string }, job: Job<NotificationJob>): Promise<number> {
    const url = parseHookUrl(config.url);
    const body = JSON.stringify(formatBody(hookKind(hook.host), job.data.payload as HookPayload));
    const timestamp = String(Math.floor(Date.now() / 1000));
    return postJson(url, body, {
      'Content-Type': 'application/json',
      'User-Agent': 'Entrify-Webhooks',
      'X-Entrify-Event': job.data.event,
      'X-Entrify-Delivery': job.id ?? '',
      'X-Entrify-Timestamp': timestamp,
      'X-Entrify-Signature': signDelivery(config.secret, timestamp, body),
    });
  }

  private async assertOwner(projectId: string, userId: string): Promise<Project> {
    const project = await this.projects.findById(projectId);
    // 404, not 403: does not say whether the project exists.
    if (!project || project.userId !== userId) throw new NotFoundError('Project');
    return project;
  }
}

function toView(hook: NotificationHook): NotificationHookView {
  const { id, host, events, lastStatus, lastAttemptAt, createdAt } = hook;
  return { id, host, kind: hookKind(host), events, lastStatus, lastAttemptAt, createdAt };
}

function payloadFor(event: string, project: PayloadProject): HookPayload {
  const url = getDeployedProjectUrl(project.slug);
  return {
    event,
    createdAt: new Date().toISOString(),
    project: { id: project.id, name: project.name, slug: project.slug, url: /^https?:\/\//.test(url) ? url : `https://${url}` },
  };
}

function outcomeOf(err: unknown): Outcome {
  if (err instanceof BlockedAddressError || err instanceof ValidationError) return 'blocked';
  const name = (err as Error)?.name;
  return name === 'AbortError' || name === 'TimeoutError' ? 'timeout' : 'unreachable';
}

function summary(p: HookPayload): string {
  const { name, url } = p.project;
  const d = p.deployment;
  if (p.event === 'deployment.succeeded') {
    return `${name} is live: ${url}${d?.commitHash ? ` (commit ${d.commitHash.slice(0, 7)})` : ''}`;
  }
  if (p.event === 'deployment.failed') {
    return `Deployment of ${name} failed: ${d?.failureReason ?? 'no reason recorded'}${d?.dashboardUrl ? `\n${d.dashboardUrl}` : ''}`;
  }
  return `Entrify will post deployment updates for ${name} here.`;
}

/** Slack and Discord get a chat message; the name and reason come from the user and the build, so neither may ping anyone. */
function formatBody(kind: HookKind, payload: HookPayload): unknown {
  if (kind === 'generic') return payload;
  const text = summary(payload);
  if (kind === 'slack') return { text: text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;') };
  return { content: text, allowed_mentions: { parse: [] } };
}

export const notificationService = new NotificationService(
  notificationHookRepository,
  deploymentRepository,
  projectRepository,
  encryptionService,
  notificationQueueAdapter,
);
