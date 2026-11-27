/**
 * Watches every live container. Run by the deployment worker, the only process
 * with the Docker socket. "Up" means what it means for the deploy readiness
 * gate: the app answers HTTP on its host port. A Dockerfile HEALTHCHECK would
 * not do: slim images have no curl, and Docker ignores "unhealthy" outside Swarm.
 */

import {
  deploymentRepository,
  type IDeploymentRepository,
  type LiveContainer,
} from '@/repositories/deployment.repository';
import { projectRepository, type IProjectRepository } from '@/repositories/project.repository';
import { answersHttp, dockerService, liveContainerName, type DockerService } from '@/services/docker/docker.service';
import { emailService, type EmailService } from '@/services/email';
import { getConfig } from '@/lib/config';
import { createLogger } from '@/lib/logger';
import { sleep } from '@/lib/utils';

const log = createLogger('health');

export const HEALTH_SWEEP_INTERVAL_MS = 60_000;
const PROBE_TIMEOUT_MS = 10_000;
/** About 3 minutes of sweeps: rides out a deploy's container swap, Docker's restart back-off and a host reboot. */
const FAILURES_TO_DOWN = 3;
const ALERT_COOLDOWN_MS = 24 * 60 * 60 * 1000;
/** This many sites going down in one sweep points at the platform, not at the apps. */
const OUTAGE_SIZE = 5;
/** The SES sandbox sends one email a second. */
const EMAIL_GAP_MS = 1100;

type WatchedProject = LiveContainer['project'];

export class ContainerHealthService {
  private sweeping = false;
  /**
   * Failed checks in a row per project and live port, and when the first one was.
   * The port is in the key so a redeploy starts a fresh streak. In memory, like
   * the domain worker's back-off: a worker restart only delays detection.
   */
  private failures = new Map<string, { count: number; since: Date }>();

  constructor(
    private readonly deployments: Pick<IDeploymentRepository, 'findLiveContainers'>,
    private readonly projects: Pick<IProjectRepository, 'setHealth'>,
    private readonly docker: Pick<DockerService, 'getContainerInfo'>,
    private readonly probe: (port: number, timeoutMs: number) => Promise<boolean> = answersHttp,
    private readonly email: Pick<EmailService, 'send'> = emailService,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /** One pass over every live container. A call while one is running returns at once. */
  async sweep(): Promise<void> {
    if (this.sweeping) return;
    this.sweeping = true;
    try {
      await this.check();
    } finally {
      this.sweeping = false;
    }
  }

  private async check(): Promise<void> {
    const live = await this.deployments.findLiveContainers();
    // Everything is inspected before anything is written: a Docker error (say,
    // a down daemon) throws here and aborts the sweep instead of marking every site down.
    const checked = await Promise.all(
      live
        .filter((row) => !row.project.stoppedAt) // an admin stopped it on purpose
        .map(async (row) => ({
          project: row.project,
          port: row.containerPort as number,
          reason: await this.diagnose(row.project.slug, row.containerPort as number),
        })),
    );
    const now = this.now();

    for (const { project } of live) {
      if (project.stoppedAt && project.unhealthySince) await this.clear(project);
    }

    const failures = new Map<string, { count: number; since: Date }>();
    const newlyDown: WatchedProject[] = [];
    for (const { project, port, reason } of checked) {
      if (reason === null) {
        if (project.unhealthySince) await this.clear(project);
        continue;
      }
      const key = `${project.id}:${port}`;
      const previous = this.failures.get(key);
      const failure = { count: (previous?.count ?? 0) + 1, since: previous?.since ?? now };
      failures.set(key, failure);
      if (project.unhealthySince) {
        if (reason !== project.healthReason) {
          await this.projects.setHealth(project.id, { healthReason: reason, updatedAt: project.updatedAt });
        }
      } else if (failure.count >= FAILURES_TO_DOWN) {
        newlyDown.push({ ...project, unhealthySince: failure.since, healthReason: reason });
      }
    }
    this.failures = failures;

    const outage = newlyDown.length >= OUTAGE_SIZE;
    if (outage) log.error('Possible platform outage', { slugs: newlyDown.map((p) => p.slug) });
    const toAlert: WatchedProject[] = [];
    for (const project of newlyDown) {
      const alert = !outage && !project.user.suspendedAt &&
        (!project.healthAlertedAt || now.getTime() - project.healthAlertedAt.getTime() >= ALERT_COOLDOWN_MS);
      // Stamped before the send, whether or not it succeeds, so attempts stay bounded.
      await this.projects.setHealth(project.id, {
        unhealthySince: project.unhealthySince,
        healthReason: project.healthReason,
        ...(alert && { healthAlertedAt: now }),
        updatedAt: project.updatedAt,
      });
      log.warn('Site is down', { slug: project.slug, reason: project.healthReason });
      if (alert) toAlert.push(project);
    }
    for (const [i, project] of toAlert.entries()) {
      if (i > 0) await sleep(EMAIL_GAP_MS);
      await this.notifyDown(project);
    }
  }

  /** Why the site is not serving, in the platform's own words (never tenant output); null when it answers. */
  private async diagnose(slug: string, port: number): Promise<string | null> {
    const info = await this.docker.getContainerInfo(liveContainerName(slug));
    if (!info) return "The site's container is missing.";
    if (info.status === 'restarting') return 'The app keeps crashing and Docker is restarting it.';
    if (!info.running) return `The app's container has stopped (${info.status}).`;
    // Probe only the port this container publishes, so a wrong row can never aim it at another service.
    if (info.ports[0]?.hostPort !== port) return "The site's container is not the one its live deployment started.";
    return (await this.probe(port, PROBE_TIMEOUT_MS))
      ? null
      : `The app is running but did not answer within ${PROBE_TIMEOUT_MS / 1000} s.`;
  }

  // Outbound webhooks will emit site.recovered here.
  private async clear(project: WatchedProject): Promise<void> {
    await this.projects.setHealth(project.id, { unhealthySince: null, healthReason: null, updatedAt: project.updatedAt });
    log.info('Site is answering again', { slug: project.slug });
  }

  /** Tells the owner, once per incident. Outbound webhooks will emit site.down here. */
  private async notifyDown(project: WatchedProject): Promise<void> {
    const { BASE_DOMAIN, NEXT_PUBLIC_APP_URL } = getConfig();
    const host = `${project.slug}.${BASE_DOMAIN}`;
    const dashboard = `${NEXT_PUBLIC_APP_URL?.replace(/\/+$/, '') ?? ''}/projects/${project.id}`;
    await this.email.send({
      to: project.user.email,
      kind: 'health',
      // The slug, not the name: owners can put anything in a project's name.
      subject: `Your site ${host} is down`,
      text:
        `Your site https://${host} has not been answering since ${project.unhealthySince?.toUTCString()}.\n\n` +
        `Why: ${project.healthReason}\n\n` +
        `Redeploy it to start a fresh container, or open Advanced → Terminal on its page:\n${dashboard}\n\n` +
        `You get at most one of these emails per site per day.\n`,
    });
  }
}

export const containerHealthService = new ContainerHealthService(deploymentRepository, projectRepository, dockerService);
